// Public contract of Module 17 (Parents): the Parent entity (User -> PARENT role -> Parent), the Parent Address with history,
// the Parent-to-School relationship, the School Manager registration workflow and the Parent's own profile.
// Other modules depend on `ParentLookup` (read-only). Parent permissions are registered through the Module 12 engine.
export { ParentService, type ParentLookup, type ParentServiceDeps, type ParentAddressSubmission, type RegisterParentInput, type UpdateParentInput, type ListParentsInput, type ParentRegistrationResult } from '../application/services/parent-service';
export { ParentPermissions, PARENT_TARGET_TYPE, registerParentAuthorization, type ParentAuthorizationDeps } from '../application/services/parent-authorization';
export { PARENT_ERROR_MESSAGES } from '../application/services/parent-error-messages';
export type { ParentDto, ParentAddressDto, ParentSchoolLinkDto } from '../application/dto/parent-dto';
export type { ParentRepository, ParentAddressEntry, ParentListQuery, ParentSortKey } from '../application/ports/parent-repository';
export type { ParentSchoolLinkRepository } from '../application/ports/parent-school-link-repository';
export { STUDENTS_MODULE_NOT_IMPLEMENTED_YET, type ParentStudentDependencies } from '../application/ports/parent-student-dependencies';
export { Parent, type ParentSnapshot } from '../domain/entities/parent';
export { ParentSchoolLink, type ParentSchoolLinkSnapshot } from '../domain/entities/parent-school-link';
export { ParentErrorCodes, parentError, type ParentErrorCode } from '../domain/errors/parent-errors';
export { ParentEventTypes, PARENT_AGGREGATE_TYPE, PARENT_SCHOOL_LINK_AGGREGATE_TYPE, type ParentEventType, type ParentEventPayload, type ParentSchoolLinkEventPayload } from '../domain/events/parent-events';
export { normalizeParentName, isSameParentName, PARENT_NAME_MAX_LENGTH, PARENT_NAME_PARTS } from '../domain/value-objects/parent-name';
export { InMemoryParentRepository, InMemoryParentSchoolLinkRepository } from '../infrastructure/services/in-memory-parent-repositories';
export { SequelizeParentRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-parent-repository';
export { SequelizeParentSchoolLinkRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-parent-school-link-repository';
export { createParentRouter, PARENT_LIST_SPEC, type ParentRouterDeps } from '../presentation/http/parent-routes';
export { parentApiDoc } from '../presentation/http/parent.openapi';
