import type { ReportPeriodDto } from './payment-report';

export type AttendanceSubjectType = 'STUDENT' | 'TEACHER';

/** What a client may ask of the ATTENDANCE report. Every id is only a REQUEST that is checked against the requester's scope. */
export interface AttendanceReportRequest {
  readonly period: { readonly kind: string; readonly startDate?: string | undefined; readonly endDate?: string | undefined };
  readonly schoolId?: string | undefined;
  readonly groupId?: string | undefined;
  readonly studentId?: string | undefined;
}

/**
 * One subject (a Student or a Teacher) in one group of one school, with how many sessions were recorded PRESENT and ABSENT in the period.
 * The group is the group OF THE RECORD (the group at the time, §65): a student who changed groups has one row per group.
 */
export interface AttendanceReportRow {
  readonly subjectType: AttendanceSubjectType;
  readonly subjectId: string;
  readonly subjectName: string | null;
  readonly schoolId: string;
  readonly schoolName: string | null;
  readonly groupId: string;
  readonly groupName: string | null;
  readonly present: number;
  readonly absent: number;
  /** present + absent. */
  readonly total: number;
}

export interface AttendanceCounts {
  readonly present: number;
  readonly absent: number;
  readonly total: number;
}

export interface AttendanceReport {
  readonly type: 'ATTENDANCE';
  readonly period: ReportPeriodDto;
  /** When the report was produced (UTC ISO). */
  readonly generatedAt: string;
  readonly rows: readonly AttendanceReportRow[];
  readonly totals: { readonly students: AttendanceCounts; readonly teachers: AttendanceCounts };
}
