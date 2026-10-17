// Public contract of Module 16 (Schools): schools that belong directly to an organization (§29-31; no Main/Sub distinction; every school
// starts PENDING and is approved by its organization's manager), the school-scoped manager link with history, GPS rules (20 m accuracy,
// 50 m geofence) and the gap-free school code (SC-000001). HTTP endpoints are protected by the Authorization Engine (`registerSchoolAuthorization`).
// Other modules depend on `SchoolLookup` (read-only) and never touch this module's tables or internals. The School Address uses the shared
// address contract (Module 15: registered governorate, free-text center/city and village).
export {
  SchoolService,
  type SchoolLookup,
  type SchoolServiceDeps,
  type SchoolAddressInput,
  type CreateSchoolInput,
  type ApproveSchoolResult,
  type ApplicantInput,
  type SubmitSchoolInput,
  type SchoolSubmissionResult,
  type ListSchoolsInput,
} from '../application/services/school-service';
export {
  OrganizationRegistrationService,
  type OrganizationRegistrationDeps,
  type OrganizationRegistrationResult,
  type RegisterOrganizationInput,
} from '../application/services/organization-registration-service';
export { registerSchoolAuthorization, SchoolPermissions, SCHOOL_TARGET_TYPE, type SchoolAuthorizationDeps } from '../application/services/school-authorization';
export { ApplicantAccountResolver } from '../application/services/applicant-account-resolver';
export { createOrganizationRouter, ORGANIZATION_LIST_SPEC, type OrganizationRouterDeps } from '../presentation/http/organization-routes';
export { createOrganizationHandlers, type OrganizationHandlerService } from '../presentation/http/organization-handlers';
export type { SchoolDto, SchoolManagerAssignmentDto } from '../application/dto/school-dto';
export type { SchoolRepository, SchoolListQuery, SchoolSortKey, SchoolStatusHistoryEntry, SchoolGpsHistoryEntry } from '../application/ports/school-repository';
export type { SchoolManagerRepository } from '../application/ports/school-manager-repository';
export type { SchoolCodeSequence } from '../application/ports/school-code-sequence';
export { SCHOOL_STATUSES, canTransitionSchoolStatus, isSchoolStatus, type SchoolStatus } from '../domain/value-objects/school-status';
export { SCHOOL_CODE_PATTERN, formatSchoolCode, isSchoolCode } from '../domain/value-objects/school-code';
export { APPLICANT_NAME_MAX_LENGTH, normalizeApplicantName } from '../domain/value-objects/applicant-name';
export { SCHOOL_NAME_MAX_LENGTH, normalizeSchoolName } from '../domain/value-objects/school-name';
export { SCHOOL_MANAGER_SOURCES, type SchoolManagerSource } from '../domain/entities/school-manager-assignment';
export {
  GPS_MAX_ACCURACY_METERS,
  SCHOOL_GEOFENCE_RADIUS_METERS,
  parseGpsFix,
  distanceMeters,
  isWithinSchoolGeofence,
  type GpsFix,
} from '../domain/value-objects/gps';
export { SchoolErrorCodes, schoolError, type SchoolErrorCode } from '../domain/errors/school-errors';
export {
  SchoolEventTypes,
  SCHOOL_AGGREGATE_TYPE,
  SCHOOL_MANAGER_AGGREGATE_TYPE,
  type SchoolEventType,
  type SchoolEventPayload,
  type SchoolManagerEventPayload,
} from '../domain/events/school-events';
export { SCHOOL_ERROR_MESSAGES } from '../application/services/school-error-messages';
export { InMemorySchoolRepository, InMemorySchoolManagerRepository, InMemorySchoolCodeSequence } from '../infrastructure/services/in-memory-school-repositories';
export { createSchoolRouter, SCHOOL_LIST_SPEC, type SchoolRouterDeps } from '../presentation/http/school-routes';
export { createSchoolHandlers, type SchoolHandlerService } from '../presentation/http/school-handlers';
export { createPublicSubmissionRateLimiter } from '../presentation/http/public-submission-rate-limit';
export { FixedWindowCounter, type FixedWindowCounterOptions } from '../presentation/http/fixed-window-counter';
export { generateApplicantPassword } from '../infrastructure/services/crypto-password-generator';
export { SequelizeSchoolRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-school-repository';
export { SequelizeSchoolManagerRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-school-manager-repository';
export { SequelizeSchoolCodeSequence } from '../infrastructure/persistence/sequelize/repositories/sequelize-school-code-sequence';
export { organizationApiDoc } from '../presentation/http/organization.openapi';
export { schoolApiDoc } from '../presentation/http/school.openapi';
