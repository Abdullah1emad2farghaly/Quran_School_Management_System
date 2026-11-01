/**
 * Memorization events (outbox, same transaction as the change). Identifiers only. Prepared for History & Audit (35) and, later, the Notifications modules:
 *  - MemorizationAssignmentDefined / Modified / Cancelled: the next-session assignment, during the current session only.
 *  - MemorizationRecorded: a student's memorization was recorded. MemorizationRecordCorrected: the Teacher corrected it during the same session (original kept in the history).
 */
export const MemorizationEventTypes = {
  ASSIGNMENT_DEFINED: 'MemorizationAssignmentDefined',
  ASSIGNMENT_MODIFIED: 'MemorizationAssignmentModified',
  ASSIGNMENT_CANCELLED: 'MemorizationAssignmentCancelled',
  RECORDED: 'MemorizationRecorded',
  RECORD_CORRECTED: 'MemorizationRecordCorrected',
} as const;
export type MemorizationEventType = (typeof MemorizationEventTypes)[keyof typeof MemorizationEventTypes];

export const MEMORIZATION_ASSIGNMENT_AGGREGATE_TYPE = 'MemorizationAssignment';
export const MEMORIZATION_RECORD_AGGREGATE_TYPE = 'MemorizationRecord';

export interface MemorizationAssignmentEventPayload {
  readonly assignmentId: string;
  readonly schoolId: string;
  readonly groupId: string;
  /** null = the shared assignment of a GROUP-mode group. */
  readonly studentId: string | null;
  readonly definedInSessionId: string;
  readonly actorUserId: string;
}
export interface MemorizationRecordEventPayload {
  readonly recordId: string;
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly studentId: string;
  readonly assignmentId: string | null;
  readonly matchesAssignment: boolean | null;
  readonly actorUserId: string;
}
