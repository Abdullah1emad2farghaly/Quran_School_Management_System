import type { EvaluationReportRow as EvaluationCountRow } from '../../../29-evaluations/public';
import type { EvaluationCategoryScores, EvaluationCategoryStats } from '../dto/evaluation-report';

export const EVALUATION_REPORT_CATEGORIES = ['MEMORIZATION', 'REVISION', 'PERFORMANCE', 'TAJWEED'] as const;
export type EvaluationReportCategory = (typeof EVALUATION_REPORT_CATEGORIES)[number];

/** Running count and exact sum in hundredths of a point (integers: no floating-point drift) per category. */
export type CategoryTotals = Record<EvaluationReportCategory, { count: number; sumHundredths: number }>;

export const emptyCategoryTotals = (): CategoryTotals => ({
  MEMORIZATION: { count: 0, sumHundredths: 0 },
  REVISION: { count: 0, sumHundredths: 0 },
  PERFORMANCE: { count: 0, sumHundredths: 0 },
  TAJWEED: { count: 0, sumHundredths: 0 },
});

/** Adds the categories of one aggregated row into running totals. */
export function addCategories(into: CategoryTotals, categories: EvaluationCountRow['categories']): void {
  for (const c of categories) {
    into[c.category].count += c.count;
    into[c.category].sumHundredths += c.sumHundredths;
  }
}

/** The arithmetic mean of the stored scores, rounded half up to two decimals; null when there is no score. Computed from the exact integer sum. */
export function averageOf(count: number, sumHundredths: number): number | null {
  return count === 0 ? null : Math.round(sumHundredths / count) / 100;
}

export const statsOf = (t: { count: number; sumHundredths: number }): EvaluationCategoryStats => ({ count: t.count, average: averageOf(t.count, t.sumHundredths) });

export const scoresOf = (t: CategoryTotals): EvaluationCategoryScores => ({
  MEMORIZATION: statsOf(t.MEMORIZATION),
  REVISION: statsOf(t.REVISION),
  PERFORMANCE: statsOf(t.PERFORMANCE),
  TAJWEED: statsOf(t.TAJWEED),
});
