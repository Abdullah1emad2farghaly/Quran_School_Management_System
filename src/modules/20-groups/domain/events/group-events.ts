/**
 * Group domain events (outbox, same transaction as the change). Identifiers and statuses ONLY: never a name or a National ID.
 *  - GroupCreated / GroupUpdated (`changedFields`) / GroupTeacherChanged (`previousTeacherId` -> `teacherId`) / GroupArchived
 *  - GroupStudentAssigned / GroupStudentUnassigned (`reason`: MANUAL, MOVED, GROUP_ARCHIVED, STUDENT_ARCHIVED)
 * A move is a GroupStudentUnassigned (MOVED) followed by a GroupStudentAssigned in the same transaction.
 */
export const GroupEventTypes = {
  GROUP_CREATED: 'GroupCreated',
  GROUP_UPDATED: 'GroupUpdated',
  GROUP_TEACHER_CHANGED: 'GroupTeacherChanged',
  GROUP_ARCHIVED: 'GroupArchived',
  GROUP_STUDENT_ASSIGNED: 'GroupStudentAssigned',
  GROUP_STUDENT_UNASSIGNED: 'GroupStudentUnassigned',
} as const;
export type GroupEventType = (typeof GroupEventTypes)[keyof typeof GroupEventTypes];

export const GROUP_AGGREGATE_TYPE = 'Group';
export const GROUP_ASSIGNMENT_AGGREGATE_TYPE = 'GroupAssignment';

export interface GroupEventPayload {
  readonly groupId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  /** The acting user; null when the system acted (a student was archived). */
  readonly actorId: string | null;
  readonly status?: string;
  readonly teacherId?: string | null;
  readonly previousTeacherId?: string | null;
  readonly changedFields?: readonly string[];
  readonly studentId?: string;
  readonly reason?: string;
}
