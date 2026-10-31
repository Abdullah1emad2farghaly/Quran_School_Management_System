// Public contract of Module 26 (Attendance, Master Specification §51): PRESENT / ABSENT for each student and for the Teacher of a class session, unique per
// (session, subject). The assigned Teacher records students in one atomic batch with one GPS reading through Smart Guard and checks themself in; the School Manager
// records or corrects at any time without GPS. The first marking needs no reason; changing an existing record is a correction (reason required, append-only history,
// AttendanceCorrected). No student is ever marked automatically (only a Teacher who did not check in by the end of the session, or who cancels it, is recorded ABSENT by the system) and nothing is deleted. Other modules depend on `AttendanceService` (reads) and on the events
// (AttendanceRecorded / AttendanceCorrected, prepared for Module 35); permissions go through the Authorization Engine (`registerAttendanceAuthorization`).
export { createMarkTeacherAbsentOnSessionEndHandler } from '../application/handlers/mark-teacher-absent-on-session-end';
export { AttendanceService, type SessionEndFacts, type SystemAbsenceOutcome, type AttendanceServiceDeps, type StudentAttendanceInput, type TeacherCheckInInput, type ManagerAttendanceInput, type AttendanceListInput } from '../application/services/attendance-service';
export type { AttendanceRepository } from '../application/ports/attendance-repository';
export type { AttendanceRecordDto, AttendanceBatchResultDto, AttendanceChangeResultDto, AttendanceOutcome, SessionAttendanceDto } from '../application/dto/attendance-dto';
export { AttendancePermissions, registerAttendanceAuthorization, type AttendanceAuthorizationDeps } from '../application/services/attendance-authorization';
export { ATTENDANCE_ERROR_MESSAGES } from '../application/services/attendance-error-messages';
export { AttendanceRecord, normalizeCorrectionReason, type AttendanceRecordSnapshot, type AttendanceCorrection } from '../domain/entities/attendance-record';
export { AttendanceErrorCodes, attendanceError, type AttendanceErrorCode } from '../domain/errors/attendance-errors';
export { AttendanceEventTypes, ATTENDANCE_AGGREGATE_TYPE, type AttendanceEventPayload } from '../domain/events/attendance-events';
export { ATTENDANCE_STATUSES, SUBJECT_TYPES, ACTOR_ROLES, SYSTEM_ACTOR_ID, SYSTEM_CANCELLATION_REASON, MAX_REASON_LENGTH, MAX_BATCH_RECORDS, type AttendanceStatus, type SubjectType, type ActorRole } from '../domain/value-objects/attendance-status';
export { InMemoryAttendanceRepository } from '../infrastructure/services/in-memory-attendance-repository';
export { SequelizeAttendanceRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-attendance-repository';
export { createAttendanceRouter, ATTENDANCE_LIST_SPEC, type AttendanceRouterDeps } from '../presentation/http/attendance-routes';
export { attendanceApiDoc } from '../presentation/http/attendance.openapi';
