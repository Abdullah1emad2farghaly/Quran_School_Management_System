import type { AttendanceCounts } from './attendance-report';
import type { EvaluationCategoryScores } from './evaluation-report';
import type { MemorizationCounts } from './memorization-report';
import type { ReportPeriodDto } from './payment-report';

/** What a client may ask of the STUDENT report. `studentId` is REQUIRED and is only a REQUEST that is checked against the requester's scope. */
export interface StudentReportRequest {
  readonly period: { readonly kind: string; readonly startDate?: string | undefined; readonly endDate?: string | undefined };
  readonly studentId: string;
}

/** The student the report is about. `joinDate` is the student's join date (`YYYY-MM-DD`, Africa/Cairo): nothing before it is ever reported (§67). The lifecycle status is not part of the report. */
export interface StudentReportStudent {
  readonly id: string;
  readonly name: string | null;
  readonly schoolId: string;
  readonly schoolName: string | null;
  readonly joinDate: string;
}

/** Attendance of the student in ONE group (the group of the attendance record, i.e. the group at the time, §65). Counts only. */
export interface StudentAttendanceRow extends AttendanceCounts {
  readonly groupId: string;
  readonly groupName: string | null;
}

/** Memorization or revision records of the student in ONE group (the group at the time), counted by the fulfilment state stored when each record was made. Counts only. */
export interface StudentRecordsRow extends MemorizationCounts {
  readonly groupId: string;
  readonly groupName: string | null;
}

/** Evaluations of the student in ONE group (the group at the time): how many, and per category how many scores exist and their mean. No combined or overall score. */
export interface StudentEvaluationRow {
  readonly groupId: string;
  readonly groupName: string | null;
  readonly evaluations: number;
  readonly scores: EvaluationCategoryScores;
}

export interface StudentAttendanceSection {
  readonly rows: readonly StudentAttendanceRow[];
  readonly totals: AttendanceCounts;
}

export interface StudentRecordsSection {
  readonly rows: readonly StudentRecordsRow[];
  readonly totals: MemorizationCounts;
}

export interface StudentEvaluationSection {
  readonly rows: readonly StudentEvaluationRow[];
  readonly totals: { readonly evaluations: number; readonly scores: EvaluationCategoryScores };
}

/**
 * One exam the student has a RECORDED outcome in (a student whose outcome is not recorded yet has no row). `examDate` is the exam's start date (Africa/Cairo business day), which decides the period.
 * `scores` and `total` are the recorded ones (immutable in Module 30); for ABSENT they are empty / null: no score exists. `maxTotal` is the exam's own maximum. Nothing is summed across exams.
 */
export interface StudentExamResultRow {
  readonly examId: string;
  /** `YYYY-MM-DD` (Africa/Cairo). */
  readonly examDate: string;
  /** The exam's start instant (UTC ISO). */
  readonly startAt: string;
  readonly groupId: string;
  readonly groupName: string | null;
  readonly outcome: 'EXAMINED' | 'ABSENT';
  readonly questionCount: number;
  readonly maxScorePerQuestion: number;
  readonly scores: readonly number[];
  readonly total: number | null;
  readonly maxTotal: number;
}

export interface StudentExamCounts {
  readonly examined: number;
  readonly absent: number;
  readonly total: number;
}

/** The exam list is the ONLY paginated part of the report (`rows` is one page); `counts` always cover EVERY exam of the report, not just the page. */
export interface StudentExamResultsSection {
  readonly counts: StudentExamCounts;
  readonly rows: readonly StudentExamResultRow[];
}

export interface StudentSubscriptionRow {
  /** `YYYY-MM` (Africa/Cairo). */
  readonly month: string;
  /** The status recorded NOW; it is not a snapshot of the past. */
  readonly status: 'PAID' | 'UNPAID' | 'WAIVED';
}

/** Only the Organization Manager and the School Manager receive this section (Teacher and Parent never do: the key is absent). `statusAsOf` is when the statuses were read: they are the CURRENT records. */
export interface StudentSubscriptionsSection {
  readonly statusAsOf: string;
  readonly rows: readonly StudentSubscriptionRow[];
  readonly totals: { readonly paid: number; readonly unpaid: number; readonly waived: number; readonly total: number };
}

/**
 * One period of the student in one group (Module 20 assignment history), limited to the effective report window: `from` is never before the effective start; `to` is the last business date of the period
 * inside the window (null: it has no end inside an unbounded window). `current` is true when the student is still in that group when the report is made.
 */
export interface StudentGroupHistoryRow {
  readonly groupId: string;
  readonly groupName: string | null;
  /** `YYYY-MM-DD` (Africa/Cairo). */
  readonly from: string;
  /** `YYYY-MM-DD` (Africa/Cairo), or null. */
  readonly to: string | null;
  readonly current: boolean;
}

export interface StudentReportSections {
  readonly attendance: StudentAttendanceSection;
  readonly memorization: StudentRecordsSection;
  readonly revision: StudentRecordsSection;
  readonly evaluations: StudentEvaluationSection;
  readonly examResults: StudentExamResultsSection;
  /** ABSENT for a Teacher or a Parent. */
  readonly subscriptions?: StudentSubscriptionsSection;
  readonly groupHistory: { readonly rows: readonly StudentGroupHistoryRow[] };
}

export interface StudentReport {
  readonly type: 'STUDENT';
  readonly period: ReportPeriodDto;
  /** When the report was produced (UTC ISO). */
  readonly generatedAt: string;
  readonly student: StudentReportStudent;
  /** MAX(join date, period start) as a business date; null when the student joined after the period ended (every section is then empty). */
  readonly effectiveStartDate: string | null;
  readonly sections: StudentReportSections;
}
