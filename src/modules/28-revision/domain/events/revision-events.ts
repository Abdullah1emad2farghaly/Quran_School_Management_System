/**
 * Revision events (outbox, same transaction as the change). Identifiers only. Prepared for History & Audit (35) and, later, the Notifications modules:
 *  - RevisionAssignmentDefined / Modified / Cancelled: the next-session assignment, during the current session only.
 *  - RevisionRecorded: a student's revision was recorded. RevisionRecordCorrected: the Teacher corrected it during the same session (original kept in the history).
 */
export const RevisionEventTypes = {
  ASSIGNMENT_DEFINED: 'RevisionAssignmentDefined',
  ASSIGNMENT_MODIFIED: 'RevisionAssignmentModified',
  ASSIGNMENT_CANCELLED: 'RevisionAssignmentCancelled',
  RECORDED: 'RevisionRecorded',
  RECORD_CORRECTED: 'RevisionRecordCorrected',
} as const;
export type RevisionEventType = (typeof RevisionEventTypes)[keyof typeof RevisionEventTypes];

export const REVISION_ASSIGNMENT_AGGREGATE_TYPE = 'RevisionAssignment';
export const REVISION_RECORD_AGGREGATE_TYPE = 'RevisionRecord';

export interface RevisionAssignmentEventPayload {
  readonly assignmentId: string;
  readonly schoolId: string;
  readonly groupId: string;
  /** null = the shared assignment of a GROUP-mode group. */
  readonly studentId: string | null;
  readonly definedInSessionId: string;
  readonly actorUserId: string;
}
export interface RevisionRecordEventPayload {
  readonly recordId: string;
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly studentId: string;
  readonly assignmentId: string | null;
  readonly matchesAssignment: boolean | null;
  readonly actorUserId: string;
}
