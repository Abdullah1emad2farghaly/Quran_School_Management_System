// Public contract of Module 20 (Groups): the Group entity (school, name, at most one Teacher, learning mode, progression, starting surah), the
// student assignment history (a student is in ONE group at a time), the real Module 18 unlink guard and Module 19 Teacher read access, and the
// consumer that unassigns an archived student. Other modules depend on `GroupLookup` (read-only). Group permissions go through the Module 12 engine.
export { GroupService, type GroupLookup, type GroupServiceDeps, type CreateGroupInput, type UpdateGroupInput, type ListGroupsInput } from '../application/services/group-service';
export { GroupPermissions, GROUP_TARGET_TYPE, registerGroupAuthorization, type GroupAuthorizationDeps } from '../application/services/group-authorization';
export { createStudentArchivedHandler } from '../application/services/student-archived-handler';
export { GROUP_ERROR_MESSAGES } from '../application/services/group-error-messages';
export type { GroupDto, GroupScopeDto, GroupStudentDto, StudentAssignmentDto, GroupHistoryDto } from '../application/dto/group-dto';
export type { GroupRepository, GroupListQuery, GroupSortKey } from '../application/ports/group-repository';
export { Group, type GroupSnapshot } from '../domain/entities/group';
export { GroupAssignment, ASSIGNMENT_END_REASONS, type GroupAssignmentSnapshot, type AssignmentEndReason } from '../domain/entities/group-assignment';
export type { GroupHistoryEntry, GroupHistoryAction } from '../domain/entities/group-history-entry';
export { GroupErrorCodes, groupError, type GroupErrorCode } from '../domain/errors/group-errors';
export { GroupEventTypes, GROUP_AGGREGATE_TYPE, GROUP_ASSIGNMENT_AGGREGATE_TYPE, type GroupEventType, type GroupEventPayload } from '../domain/events/group-events';
export { GROUP_STATUSES, LEARNING_MODES, PROGRESSIONS, SURAH_COUNT, isGroupStatus, type GroupStatus, type LearningMode, type Progression } from '../domain/value-objects/group-settings';
export { InMemoryGroupRepository } from '../infrastructure/services/in-memory-group-repository';
export { SequelizeGroupRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-group-repository';
export { createGroupRouter, GROUP_LIST_SPEC, OWN_GROUPS_SPEC, GROUP_STUDENTS_SPEC, type GroupRouterDeps } from '../presentation/http/group-routes';
export { groupApiDoc } from '../presentation/http/group.openapi';
