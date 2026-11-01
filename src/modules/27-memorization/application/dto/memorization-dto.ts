import type { MemorizationAssignment } from '../../domain/entities/memorization-assignment';
import type { MemorizationRecord } from '../../domain/entities/memorization-record';
import type { AssignmentStatus, MemorizationRange } from '../../domain/value-objects/memorization-range';

export interface AssignmentDto {
  readonly id: string;
  readonly schoolId: string;
  readonly groupId: string;
  /** null = the shared assignment of a GROUP-mode group. */
  readonly studentId: string | null;
  readonly definedInSessionId: string;
  readonly definedByUserId: string;
  readonly range: MemorizationRange;
  readonly status: AssignmentStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RecordDto {
  readonly id: string;
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly studentId: string;
  readonly assignmentId: string | null;
  readonly range: MemorizationRange;
  readonly matchesAssignment: boolean | null;
  readonly recordedBy: string;
  readonly recordedAt: Date;
  readonly updatedBy: string;
  readonly updatedAt: Date;
}

export const toAssignmentDto = (a: MemorizationAssignment): AssignmentDto => ({ ...a.snapshot });
export const toRecordDto = (r: MemorizationRecord): RecordDto => ({ ...r.snapshot });

/** What a session holds: the assignments scheduled FOR it (defined before it started), the assignments defined DURING it (for the next session) and its records. */
export interface SessionMemorizationDto {
  readonly sessionId: string;
  readonly scheduled: readonly AssignmentDto[];
  readonly defined: readonly AssignmentDto[];
  readonly records: readonly RecordDto[];
}

export interface RecordBatchResultDto {
  readonly sessionId: string;
  readonly results: ReadonlyArray<{ readonly studentId: string; readonly outcome: 'RECORDED'; readonly record: RecordDto }>;
}

export interface RecordCorrectionResultDto {
  readonly outcome: 'CORRECTED' | 'UNCHANGED';
  readonly record: RecordDto;
}

/**
 * The public READ contract for the future Notifications modules (31-34, the half-session reminder, Master Specification §63): for a session, whether memorization was
 * SCHEDULED for it (a specific assignment explicitly defined before it started) and which memorization records exist. Nothing here creates or changes anything.
 */
export interface ScheduledMemorizationDto {
  readonly sessionId: string;
  readonly groupId: string;
  readonly teacherId: string;
  readonly status: string;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
  /** true when at least one assignment is scheduled for the session. false: nothing is scheduled (no reminder, whatever the records). */
  readonly scheduled: boolean;
  readonly assignments: readonly AssignmentDto[];
  readonly records: readonly RecordDto[];
  /** Students that have at least one record in the session. */
  readonly studentsWithRecords: readonly string[];
  /** GROUP mode: the shared assignment has no record yet. INDIVIDUAL mode: the students whose scheduled assignment has no record in the session yet. */
  readonly unrecordedAssignmentIds: readonly string[];
}
