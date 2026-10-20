import type { StudentStatus } from '../value-objects/student-status';

export type StudentHistoryAction = 'REGISTERED' | 'DETAILS_UPDATED' | 'STATUS_CHANGED';

/**
 * One row of the Student history (Master Specification §65 / §103): what changed, who did it, when, and why. Append-only: rows are never
 * updated or deleted. `previous*` is null when nothing applied (registration) or when that attribute did not change.
 */
export interface StudentHistoryEntry {
  readonly id: string;
  readonly studentId: string;
  readonly action: StudentHistoryAction;
  readonly actorId: string;
  readonly occurredAt: Date;
  readonly reason: string | null;
  readonly previousStatus: StudentStatus | null;
  readonly newStatus: StudentStatus | null;
  readonly previousFullName: string | null;
  readonly newFullName: string | null;
  readonly previousJoinDate: string | null;
  readonly newJoinDate: string | null;
}
