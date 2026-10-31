import type { AttendanceCorrection, AttendanceRecord } from '../../domain/entities/attendance-record';
import type { ActorRole, AttendanceStatus, SubjectType } from '../../domain/value-objects/attendance-status';

export interface AttendanceRecordDto {
  readonly id: string;
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly subjectType: SubjectType;
  readonly subjectId: string;
  readonly status: AttendanceStatus;
  readonly occurrenceDate: string;
  readonly scheduledStart: Date;
  readonly recordedBy: string;
  readonly recordedByRole: ActorRole;
  readonly recordedAt: Date;
  readonly updatedBy: string;
  readonly updatedByRole: ActorRole;
  readonly updatedAt: Date;
}

export const toAttendanceDto = (record: AttendanceRecord): AttendanceRecordDto => ({ ...record.snapshot });

export type AttendanceOutcome = 'RECORDED' | 'CORRECTED' | 'UNCHANGED';

export interface AttendanceChangeResultDto {
  readonly subjectId: string;
  readonly outcome: AttendanceOutcome;
  readonly record: AttendanceRecordDto;
}

/** The result of recording or correcting attendance: one entry per submitted subject, in the order submitted. */
export interface AttendanceBatchResultDto {
  readonly sessionId: string;
  readonly results: readonly AttendanceChangeResultDto[];
}

export interface SessionAttendanceDto {
  readonly sessionId: string;
  readonly teacher: AttendanceRecordDto | null;
  readonly students: readonly AttendanceRecordDto[];
}

export type AttendanceCorrectionDto = AttendanceCorrection;
