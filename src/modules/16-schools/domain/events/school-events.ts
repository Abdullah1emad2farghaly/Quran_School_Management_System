/**
 * School domain events (outbox, same transaction as the change). Payloads carry identifiers ONLY: no names, reasons,
 * coordinates or phones. Consumers read what they are authorized to see from the school record.
 *  - SchoolCreated: a school was created (always PENDING).
 *  - SchoolApproved / SchoolRejected: the organization manager's decision on a PENDING school.
 *  - SchoolDeactivated / SchoolReactivated: ACTIVE <-> INACTIVE.
 *  - SchoolGpsCorrected: official GPS corrected while PENDING.
 *  - SchoolManagerAssigned / SchoolManagerRevoked: school-scoped manager link.
 */
export const SchoolEventTypes = {
  SCHOOL_CREATED: 'SchoolCreated',
  SCHOOL_APPROVED: 'SchoolApproved',
  SCHOOL_REJECTED: 'SchoolRejected',
  SCHOOL_DEACTIVATED: 'SchoolDeactivated',
  SCHOOL_REACTIVATED: 'SchoolReactivated',
  SCHOOL_GPS_CORRECTED: 'SchoolGpsCorrected',
  SCHOOL_MANAGER_ASSIGNED: 'SchoolManagerAssigned',
  SCHOOL_MANAGER_REVOKED: 'SchoolManagerRevoked',
} as const;
export type SchoolEventType = (typeof SchoolEventTypes)[keyof typeof SchoolEventTypes];

export const SCHOOL_AGGREGATE_TYPE = 'School';
export const SCHOOL_MANAGER_AGGREGATE_TYPE = 'SchoolManagerAssignment';

export interface SchoolEventPayload {
  readonly schoolId: string;
  /** The acting user (creator, approver, rejecter...). */
  readonly actorId: string;
}

export interface SchoolManagerEventPayload {
  readonly assignmentId: string;
  readonly schoolId: string;
  readonly userId: string;
  readonly actorId: string;
}
