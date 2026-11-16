import type { AuthorizationPolicyRegistry } from '../../../12-authorization-engine/public';

/** Permissions of attendance (registered ONLY through the shared Authorization Engine). Codes are `<module>.<resource>.<action>`. */
export const AttendancePermissions = {
  RECORD_STUDENTS: 'attendance.student.record',
  CHECK_IN_TEACHER: 'attendance.teacher.check-in',
  CORRECT: 'attendance.record.correct',
  READ_SESSION: 'attendance.session.read',
  READ_STUDENT: 'attendance.student.read',
} as const;

export interface AttendanceAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
}

/**
 * Module 26 registers what it owns (approved Module 26 decisions); no scope resolver is added: it reuses Module 20's MANAGEMENT/GROUP resolver (the target is the
 * session's group, loaded on the server) and Module 19's MANAGEMENT/STUDENT resolver (a Parent only for their own linked child).
 *   - attendance.student.record, attendance.teacher.check-in: the TEACHER of the ACTIVE group, in addition to Smart Guard (GPS, window, ownership of the session).
 *   - attendance.record.correct: the SCHOOL_MANAGER of the group's school, at any time, WITHOUT GPS.
 *   - attendance.session.read: SCHOOL_MANAGER and TEACHER; the application further limits a Teacher to the sessions assigned to them.
 *   - attendance.student.read: SCHOOL_MANAGER (their school) and PARENT (their own linked children only).
 * STUDENT, ORGANIZATION_MANAGER and MAIN_ADMIN have no attendance permission (deny by default). Call once per process.
 */
export function registerAttendanceAuthorization(deps: AttendanceAuthorizationDeps): void {
  deps.policies.register({ code: AttendancePermissions.RECORD_STUDENTS, roles: ['TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: AttendancePermissions.CHECK_IN_TEACHER, roles: ['TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: AttendancePermissions.CORRECT, roles: ['SCHOOL_MANAGER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: AttendancePermissions.READ_SESSION, roles: ['SCHOOL_MANAGER', 'TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: AttendancePermissions.READ_STUDENT, roles: ['SCHOOL_MANAGER', 'PARENT'], scope: 'MANAGEMENT' });
}
