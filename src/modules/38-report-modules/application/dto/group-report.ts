import type { AttendanceCounts } from './attendance-report';
import type { EvaluationCategoryScores } from './evaluation-report';
import type { MemorizationCounts } from './memorization-report';
import type { ReportPeriodDto } from './payment-report';
import type { StudentExamCounts } from './student-report';

/** What a client may ask of the GROUP report. `groupId` is REQUIRED and is only a REQUEST that is checked against the requester's scope. */
export interface GroupReportRequest {
  readonly period: { readonly kind: string; readonly startDate?: string | undefined; readonly endDate?: string | undefined };
  readonly groupId: string;
}

/** The group header: name, school, learning mode, status and the current Teacher's NAME (never a phone number). */
export interface GroupReportGroup {
  readonly id: string;
  readonly name: string;
  readonly schoolId: string;
  readonly schoolName: string | null;
  readonly learningMode: string;
  readonly status: string;
  readonly teacherName: string | null;
}

/** Evaluations of a student (or of the whole roster) in this group: how many, and PER CATEGORY how many scores exist and their mean. No combined or overall score. */
export interface GroupEvaluationFigures {
  readonly evaluations: number;
  readonly scores: EvaluationCategoryScores;
}

/**
 * One student of the group's roster (everyone assigned to the group at any time inside the effective window, §67, with or without activity). Counts and per-category means only: no exam score, no overall
 * score, no ranking, no weighting. The lifecycle status is never shown. `effectiveStartDate` = MAX(join date, period start).
 */
export interface GroupStudentRow {
  readonly studentId: string;
  readonly name: string;
  readonly effectiveStartDate: string;
  readonly attendance: AttendanceCounts;
  readonly memorization: MemorizationCounts;
  readonly revision: MemorizationCounts;
  readonly evaluations: GroupEvaluationFigures;
  readonly exams: StudentExamCounts;
}

/** The totals over the WHOLE eligible roster (never just the page). Nothing is compared between students. */
export interface GroupReportTotals {
  readonly students: number;
  readonly attendance: AttendanceCounts;
  readonly memorization: MemorizationCounts;
  readonly revision: MemorizationCounts;
  readonly evaluations: GroupEvaluationFigures;
  readonly exams: StudentExamCounts;
}

/**
 * The report of ONE group (Master Specification §68), data only. `students` is ONE PAGE of the roster (the only pagination of the report; files hold every student); `totals` covers the complete roster.
 * `teacherAttendance` is the group's Teacher attendance (the existing ATTENDANCE report's authoritative records) and exists only for the roles the ATTENDANCE report shows it to (the Organization Manager and the
 * School Manager); it is absent for a Teacher. No subscription, payment or other financial data is ever part of this report.
 */
export interface GroupReport {
  readonly type: 'GROUP';
  readonly period: ReportPeriodDto;
  /** When the report was produced (UTC ISO). */
  readonly generatedAt: string;
  readonly group: GroupReportGroup;
  readonly students: readonly GroupStudentRow[];
  readonly totals: GroupReportTotals;
  readonly teacherAttendance?: AttendanceCounts;
}
