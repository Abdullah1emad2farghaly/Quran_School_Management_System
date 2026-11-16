/**
 * Attendance events (outbox, same transaction as the change). Identifiers, statuses and the correction reason only. Prepared for the History & Audit module (35):
 *  - AttendanceRecorded: the FIRST record of a student or Teacher for a session.
 *  - AttendanceCorrected: an existing record changed status (previous and new status, reason, who and in which role). An unchanged status publishes nothing.
 */
export const AttendanceEventTypes = {
  RECORDED: 'AttendanceRecorded',
  CORRECTED: 'AttendanceCorrected',
} as const;
export type AttendanceEventType = (typeof AttendanceEventTypes)[keyof typeof AttendanceEventTypes];

export const ATTENDANCE_AGGREGATE_TYPE = 'AttendanceRecord';

export interface AttendanceEventPayload {
  readonly recordId: string;
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly status: string;
  readonly actorUserId: string;
  readonly actorRole: string;
  readonly previousStatus?: string;
  readonly reason?: string;
}
