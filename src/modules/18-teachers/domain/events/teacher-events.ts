/**
 * Teacher domain events (outbox, same transaction as the change). Payloads carry identifiers ONLY: no names, phones or passwords.
 *  - TeacherRegistered: a Teacher record was created for an account (new, or an existing identity-confirmed one).
 *  - TeacherSchoolLinked / TeacherSchoolLinkRemoved: the Teacher-to-School relationship (one per school, with history).
 */
export const TeacherEventTypes = {
  TEACHER_REGISTERED: 'TeacherRegistered',
  TEACHER_SCHOOL_LINKED: 'TeacherSchoolLinked',
  TEACHER_SCHOOL_LINK_REMOVED: 'TeacherSchoolLinkRemoved',
} as const;
export type TeacherEventType = (typeof TeacherEventTypes)[keyof typeof TeacherEventTypes];

export const TEACHER_AGGREGATE_TYPE = 'Teacher';
export const TEACHER_SCHOOL_LINK_AGGREGATE_TYPE = 'TeacherSchoolLink';

export interface TeacherEventPayload {
  readonly teacherId: string;
  readonly userId: string;
  readonly organizationId: string;
  /** The acting user. */
  readonly actorId: string;
}

export interface TeacherSchoolLinkEventPayload {
  readonly linkId: string;
  readonly teacherId: string;
  readonly userId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly actorId: string;
}
