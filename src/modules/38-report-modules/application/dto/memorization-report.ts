import type { ReportPeriodDto } from './payment-report';

/** What a client may ask of the MEMORIZATION report. Every id is only a REQUEST that is checked against the requester's scope. */
export interface MemorizationReportRequest {
  readonly period: { readonly kind: string; readonly startDate?: string | undefined; readonly endDate?: string | undefined };
  readonly schoolId?: string | undefined;
  readonly groupId?: string | undefined;
  readonly studentId?: string | undefined;
}

/**
 * The memorization records counted by the fulfilment state Module 27 stored when each record was made (data only: no score, grade, rate or completion rule).
 *  - `fulfilled`: the recorded range is exactly the assigned range (Module 27 `matchesAssignment = true`);
 *  - `notFulfilled`: a different range was recorded against a scheduled assignment (`matchesAssignment = false`);
 *  - `unscheduled`: nothing was scheduled for the student in that session (`matchesAssignment = null`);
 *  - `records`: the sum of the three.
 */
export interface MemorizationCounts {
  readonly records: number;
  readonly fulfilled: number;
  readonly notFulfilled: number;
  readonly unscheduled: number;
}

/**
 * One student in one group of one school. The group is the group OF THE RECORD (the group at the time, §65): a student who changed groups has one row per group.
 * A record belongs to the period of its session's scheduled start (Africa/Cairo business day, §71).
 */
export interface MemorizationReportRow extends MemorizationCounts {
  readonly studentId: string;
  readonly studentName: string | null;
  readonly schoolId: string;
  readonly schoolName: string | null;
  readonly groupId: string;
  readonly groupName: string | null;
}

export interface MemorizationReport {
  readonly type: 'MEMORIZATION';
  readonly period: ReportPeriodDto;
  /** When the report was produced (UTC ISO). */
  readonly generatedAt: string;
  readonly rows: readonly MemorizationReportRow[];
  readonly totals: MemorizationCounts;
}
