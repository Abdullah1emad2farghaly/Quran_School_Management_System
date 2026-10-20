// Public contract of Module 18 (Teachers): the Teacher entity (User -> TEACHER role -> Teacher), the Teacher-to-School relationship with history,
// the School Manager registration workflow (new account with the initial password and the mandatory first-login change, or identity-matched reuse)
// and the Teacher's own profile. Other modules depend on `TeacherLookup` (read-only). Teacher permissions are registered through the Module 12 engine.
export { TeacherService, type TeacherLookup, type TeacherServiceDeps, type RegisterTeacherInput, type ListTeachersInput, type TeacherRegistrationResult } from '../application/services/teacher-service';
export { TeacherPermissions, TEACHER_TARGET_TYPE, registerTeacherAuthorization, type TeacherAuthorizationDeps } from '../application/services/teacher-authorization';
export { TEACHER_ERROR_MESSAGES } from '../application/services/teacher-error-messages';
export type { TeacherDto, TeacherSchoolLinkDto } from '../application/dto/teacher-dto';
export type { TeacherRepository, TeacherListQuery, TeacherSortKey } from '../application/ports/teacher-repository';
export type { TeacherSchoolLinkRepository } from '../application/ports/teacher-school-link-repository';
export { GROUPS_MODULE_NOT_IMPLEMENTED_YET, type TeacherGroupDependencies } from '../application/ports/teacher-group-dependencies';
export { Teacher, type TeacherSnapshot } from '../domain/entities/teacher';
export { TeacherSchoolLink, type TeacherSchoolLinkSnapshot } from '../domain/entities/teacher-school-link';
export { TeacherErrorCodes, teacherError, type TeacherErrorCode } from '../domain/errors/teacher-errors';
export { TeacherEventTypes, TEACHER_AGGREGATE_TYPE, TEACHER_SCHOOL_LINK_AGGREGATE_TYPE, type TeacherEventType, type TeacherEventPayload, type TeacherSchoolLinkEventPayload } from '../domain/events/teacher-events';
export { normalizeTeacherName, isSameTeacherName } from '../domain/value-objects/teacher-name';
export { InMemoryTeacherRepository, InMemoryTeacherSchoolLinkRepository } from '../infrastructure/services/in-memory-teacher-repositories';
export { SequelizeTeacherRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-teacher-repository';
export { SequelizeTeacherSchoolLinkRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-teacher-school-link-repository';
export { createTeacherRouter, TEACHER_LIST_SPEC, type TeacherRouterDeps } from '../presentation/http/teacher-routes';
export { teacherApiDoc } from '../presentation/http/teacher.openapi';
