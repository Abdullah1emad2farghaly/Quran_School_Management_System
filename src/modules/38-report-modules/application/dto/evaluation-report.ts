import type { ReportPeriodDto } from './payment-report';

/** What a client may ask of the EVALUATION report. Every id is only a REQUEST that is checked against the requester's scope. */
export interface EvaluationReportRequest {
  readonly period: { readonly kind: string; readonly startDate?: string | undefined; readonly endDate?: string | undefined };
  readonly schoolId?: string | undefined;
  readonly groupId?: string | undefined;
  readonly studentId?: string | undefined;
}

/**
 * The stored scores of ONE category (Module 29: each category has its own independent score out of 10, only for the categories available to the student).
 *  - `count`: how many evaluations in the period have a score in this category;
 *  - `average`: the arithmetic mean of those stored scores, rounded half up to two decimals; null when `count` is 0.
 * There is NO combined or overall score: the categories are independent and no weighting exists (none was approved), so none is invented.
 */
export interface EvaluationCategoryStats {
  readonly count: number;
  readonly average: number | null;
}

export interface EvaluationCategoryScores {
  readonly MEMORIZATION: EvaluationCategoryStats;
  readonly REVISION: EvaluationCategoryStats;
  readonly PERFORMANCE: EvaluationCategoryStats;
  readonly TAJWEED: EvaluationCategoryStats;
}

/**
 * One student in one group of one school. The group is the group OF THE EVALUATION (the group at the time, §65). `evaluations` is the number of evaluations (one per student per session) in
 * the period. The Teacher's note is NEVER part of the report (it is a per-session text, not a figure).
 */
export interface EvaluationReportRow {
  readonly studentId: string;
  readonly studentName: string | null;
  readonly schoolId: string;
  readonly schoolName: string | null;
  readonly groupId: string;
  readonly groupName: string | null;
  readonly evaluations: number;
  readonly scores: EvaluationCategoryScores;
}

/** The totals over EVERY row of the report; each average is over all the scores of the category (not an average of the row averages). */
export interface EvaluationReportTotals {
  readonly evaluations: number;
  readonly scores: EvaluationCategoryScores;
}

export interface EvaluationReport {
  readonly type: 'EVALUATION';
  readonly period: ReportPeriodDto;
  /** When the report was produced (UTC ISO). */
  readonly generatedAt: string;
  readonly rows: readonly EvaluationReportRow[];
  readonly totals: EvaluationReportTotals;
}
