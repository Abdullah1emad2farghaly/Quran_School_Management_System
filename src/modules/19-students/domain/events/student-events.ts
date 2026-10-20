/**
 * Student domain events (outbox, same transaction as the change). Payloads carry identifiers and statuses ONLY: never a name, a National ID
 * or an address.
 *  - StudentRegistered: a Student record was created.
 *  - StudentUpdated: the name and/or the join date was corrected (`changedFields` names which).
 *  - StudentStatusChanged: ACTIVE / INACTIVE / ARCHIVED lifecycle change.
 * Group and assignment events belong to Module 20.
 */
export const StudentEventTypes = {
  STUDENT_REGISTERED: 'StudentRegistered',
  STUDENT_UPDATED: 'StudentUpdated',
  STUDENT_STATUS_CHANGED: 'StudentStatusChanged',
} as const;
export type StudentEventType = (typeof StudentEventTypes)[keyof typeof StudentEventTypes];

export const STUDENT_AGGREGATE_TYPE = 'Student';

export interface StudentEventPayload {
  readonly studentId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly parentId: string;
  /** The acting user. */
  readonly actorId: string;
  readonly status: string;
  readonly previousStatus?: string;
  readonly changedFields?: readonly string[];
}
