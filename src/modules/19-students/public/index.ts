// Public contract of Module 19 (Students): the Student entity (a business entity with exactly one Parent, no login), the three-part name rule,
// the globally unique National ID, the ACTIVE / INACTIVE / ARCHIVED lifecycle with history, and the unlink guard Module 17 needs.
// Other modules depend on `StudentLookup` (read-only). Student permissions are registered through the Module 12 engine.
export { StudentService, type StudentLookup, type StudentServiceDeps, type RegisterStudentInput, type UpdateStudentInput, type ListStudentsInput } from '../application/services/student-service';
export { StudentPermissions, STUDENT_TARGET_TYPE, registerStudentAuthorization, type StudentAuthorizationDeps } from '../application/services/student-authorization';
export { STUDENT_ERROR_MESSAGES } from '../application/services/student-error-messages';
export type { StudentDto, StudentHistoryDto, StudentScopeDto } from '../application/dto/student-dto';
export type { StudentRepository, StudentListQuery, StudentSortKey } from '../application/ports/student-repository';
export { GROUPS_MODULE_NOT_IMPLEMENTED_YET_FOR_STUDENTS, type StudentGroupAccess } from '../application/ports/student-group-access';
export { Student, type StudentSnapshot } from '../domain/entities/student';
export type { StudentHistoryEntry, StudentHistoryAction } from '../domain/entities/student-history-entry';
export { StudentErrorCodes, studentError, type StudentErrorCode } from '../domain/errors/student-errors';
export { StudentEventTypes, STUDENT_AGGREGATE_TYPE, type StudentEventType, type StudentEventPayload } from '../domain/events/student-events';
export { STUDENT_STATUSES, LIFECYCLE as STUDENT_LIFECYCLE, isStudentStatus, type StudentStatus, type StudentLifecycleAction } from '../domain/value-objects/student-status';
export { normalizeNationalId, NATIONAL_ID_LENGTH } from '../domain/value-objects/student-national-id';
export { normalizeStudentName, studentNameMatchesParent, STUDENT_NAME_MIN_PARTS } from '../domain/value-objects/student-name';
export { InMemoryStudentRepository } from '../infrastructure/services/in-memory-student-repository';
export { SequelizeStudentRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-student-repository';
export { createStudentRouter, STUDENT_LIST_SPEC, type StudentRouterDeps } from '../presentation/http/student-routes';
export { studentApiDoc } from '../presentation/http/student.openapi';
