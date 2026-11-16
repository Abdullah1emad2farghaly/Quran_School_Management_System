/** Attendance statuses (Master Specification §51): only PRESENT and ABSENT. */
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Unique per (session, subject): Session + Student and Session + Teacher (§51). */
export const SUBJECT_TYPES = ['STUDENT', 'TEACHER'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/**
 * Who recorded or changed a record: the session's Teacher (through Smart Guard), the School Manager (no GPS), or the SYSTEM for the ONE automatic rule: a Teacher who has
 * not recorded their attendance when their session is COMPLETED, or who cancels the session, is ABSENT in it (approved by the project owner).
 */
export const ACTOR_ROLES = ['TEACHER', 'SCHOOL_MANAGER', 'SYSTEM'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

/** The user id stored for an automatic (SYSTEM) change: the nil UUID, which is no user's id. */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';
/** The reason kept in the history when the system changes an existing PRESENT record to ABSENT because the Teacher cancelled the session. */
export const SYSTEM_CANCELLATION_REASON = 'SESSION_CANCELLED_BY_TEACHER';

export const MAX_REASON_LENGTH = 500;
/** Students in one batch (a technical limit; a group is far smaller). */
export const MAX_BATCH_RECORDS = 200;

export const isAttendanceStatus = (value: unknown): value is AttendanceStatus => typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value);
