// Public contract of Module 13 (Main Organization).
// Many organizations, each with: id, code, name (unique system-wide), status, a required country (`countryId`, the primary key of the
// countries row; assigned once and immutable) and its OWN address (registered governorate; center and village are FREE TEXT). Manager links
// (table `organization_admins`): `isOrganizationAdmin` / `listAdministeredOrganizationIds` mean "manager of this organization" (the
// organization scope of the ORGANIZATION_MANAGER role; MAIN_ADMIN is the platform administrator and has no organization link).
// Permissions of the organization resource are registered here through the Authorization Engine (`registerOrganizationAuthorization`).
// Downstream modules (Geography 14, Schools 16) depend on `OrganizationLookup` (read-only) and may reference
// `organizations.id` from their own tables with a Foreign Key (ON DELETE RESTRICT); they must not query the table
// or import this module's internals. No HTTP endpoints (they live in Module 16), no deletion.
// Country-dependent modules use `requireMainOrganizationCountryId()` (fails closed while the country is not set).
export {
  OrganizationService,
  type OrganizationLookup,
  type OrganizationServiceDeps,
  type EnsureOrganizationResult,
  type AssignOrganizationCountryResult,
  type CreateOrganizationInput,
} from '../application/services/organization-service';
export {
  registerOrganizationAuthorization,
  OrganizationPermissions,
  ORGANIZATION_TARGET_TYPE,
  type OrganizationAuthorizationDeps,
} from '../application/services/organization-authorization';
export type { OrganizationDto } from '../application/dto/organization-dto';
export type { OrganizationAdminRepository } from '../application/ports/organization-admin-repository';
export type { OrganizationRepository } from '../application/ports/organization-repository';
export { ORGANIZATION_STATUSES, isOrganizationStatus, type OrganizationStatus } from '../domain/value-objects/organization-status';
export { isOrganizationCode, formatOrganizationCode } from '../domain/value-objects/organization-code';
export { normalizeOrganizationName, ORGANIZATION_NAME_MAX_LENGTH } from '../domain/value-objects/organization-name';
export {
  OrganizationEventTypes,
  ORGANIZATION_AGGREGATE_TYPE,
  type OrganizationEventPayload,
  type OrganizationCountryAssignedPayload,
  type OrganizationAdminAssignedPayload,
  ORGANIZATION_ADMIN_AGGREGATE_TYPE,
} from '../domain/events/organization-events';
export { OrganizationErrorCodes, organizationError, type OrganizationErrorCode } from '../domain/errors/organization-errors';
export { ORGANIZATION_ERROR_MESSAGES } from '../application/services/organization-error-messages';
export { InMemoryOrganizationRepository, InMemoryOrganizationAdminRepository } from '../infrastructure/services/in-memory-organization-repository';
export { SequelizeOrganizationRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-organization-repository';
export { SequelizeOrganizationAdminRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-organization-admin-repository';
