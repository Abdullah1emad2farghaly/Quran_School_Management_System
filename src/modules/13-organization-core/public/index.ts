// Public contract of Module 13 (Main Organization).
// V1 has exactly ONE organization with the approved fields only: id, code, name, status.
// Downstream modules (Geography 14, Schools 16) depend on `OrganizationLookup` (read-only) and may reference
// `organizations.id` from their own tables with a Foreign Key (ON DELETE RESTRICT); they must not query the table
// or import this module's internals. No HTTP endpoints, no permissions, no deletion.
export {
  OrganizationService,
  type OrganizationLookup,
  type OrganizationServiceDeps,
  type EnsureOrganizationResult,
} from '../application/services/organization-service';
export type { OrganizationDto } from '../application/dto/organization-dto';
export type { OrganizationRepository } from '../application/ports/organization-repository';
export { ORGANIZATION_STATUSES, isOrganizationStatus, type OrganizationStatus } from '../domain/value-objects/organization-status';
export { isOrganizationCode, formatOrganizationCode } from '../domain/value-objects/organization-code';
export { normalizeOrganizationName, ORGANIZATION_NAME_MAX_LENGTH } from '../domain/value-objects/organization-name';
export {
  OrganizationEventTypes,
  ORGANIZATION_AGGREGATE_TYPE,
  type OrganizationEventPayload,
} from '../domain/events/organization-events';
export { OrganizationErrorCodes, organizationError, type OrganizationErrorCode } from '../domain/errors/organization-errors';
export { ORGANIZATION_ERROR_MESSAGES } from '../application/services/organization-error-messages';
export { InMemoryOrganizationRepository } from '../infrastructure/services/in-memory-organization-repository';
export { SequelizeOrganizationRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-organization-repository';
