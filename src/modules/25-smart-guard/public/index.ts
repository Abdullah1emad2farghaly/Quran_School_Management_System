// Public contract of Module 25 (Smart Guard, Master Specification §50 and §101): reusable infrastructure with NO HTTP endpoint and NO storage. A protected Teacher
// action (attendance, memorization, revision, evaluation: Modules 26-30) calls `SmartGuard.check` after its own authentication, permission, scope and ownership
// checks; it returns only when the action is allowed and throws a SMART_GUARD_* AppError otherwise. Session cancellation is NOT protected.
// Actual code dependencies: Module 16 (school official GPS and status, GPS utilities) and Module 24 (session times, school, group, Teacher, status).
export { SmartGuard, type SmartGuardDeps, type SmartGuardCheckInput, type SmartGuardAllowance } from '../application/services/smart-guard';
export { SMART_GUARD_ERROR_MESSAGES } from '../application/services/smart-guard-error-messages';
export { SmartGuardErrorCodes, smartGuardError, type SmartGuardErrorCode } from '../domain/errors/smart-guard-errors';
export { readGpsReading, type GpsReading } from '../domain/value-objects/gps-reading';
export { protectedWindowOf, isInsideProtectedWindow } from '../domain/services/protected-window';
