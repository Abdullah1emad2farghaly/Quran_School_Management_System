// Public contract of Module 13 (Main Organization).
// Many organizations, each with: id, code, name (unique system-wide), status, a required country (`countryId`, the primary key of the
// countries row; assigned once and immutable) and its OWN address (governorate, optional center and village). Administrator links:
// `isOrganizationAdmin` / `listAdministeredOrganizationIds` (the organization scope of MAIN_ADMIN).
// Downstream modules (Geography 14, Schools 16) depend on `OrganizationLookup` (read-only) and may reference
// `organizations.id` from their own tables with a Foreign Key (ON DELETE RESTRICT); they must not query the table
// or import this module's internals. No HTTP endpoints, no permissions, no deletion.
// Country-dependent modules use `requireMainOrganizationCountryId()` (fails closed while the country is not set).
export {
  OrganizationService,
  type OrganizationLookup,
  type OrganizationServiceDeps,
  type EnsureOrganizationResult,
  type AssignOrganizationCountryResult,
  type CreateOrganizationInput,
} from '../application/services/organization-service';
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
