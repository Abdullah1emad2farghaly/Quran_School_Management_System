import type { ReportPeriodKind } from '../../../37-reports-core/public';

/** The period a report covers, as the business dates the requester sees (`null` on both sides for ACROSS_TIME). */
export interface ReportPeriodDto {
  readonly kind: ReportPeriodKind;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

/**
 * One school and billing month of the PAYMENT report (data only, no amounts: the system stores none, §60).
 *  - paid / unpaid / waived: how many subscriptions of that school and month are in each status RIGHT NOW (Module 33);
 *  - subscriptions: paid + unpaid + waived;
 *  - paymentsRecorded: the successful payments of that school and month that stand (Module 34);
 *  - paymentsReversed: the payments of that school and month that were reversed (history is kept, never deleted).
 */
export interface PaymentReportRow {
  readonly schoolId: string;
  readonly schoolName: string | null;
  /** `YYYY-MM` (Africa/Cairo). */
  readonly month: string;
  readonly paid: number;
  readonly unpaid: number;
  readonly waived: number;
  readonly subscriptions: number;
  readonly paymentsRecorded: number;
  readonly paymentsReversed: number;
}

export interface PaymentReportTotals {
  readonly paid: number;
  readonly unpaid: number;
  readonly waived: number;
  readonly subscriptions: number;
  readonly paymentsRecorded: number;
  readonly paymentsReversed: number;
}

export interface PaymentReport {
  readonly type: 'PAYMENT';
  readonly period: ReportPeriodDto;
  /** When the report was produced (UTC ISO). */
  readonly generatedAt: string;
  readonly rows: readonly PaymentReportRow[];
  readonly totals: PaymentReportTotals;
}

/** What a client may ask of the PAYMENT report. Every id is only a REQUEST that is checked against the requester's scope. */
export interface PaymentReportRequest {
  readonly period: { readonly kind: string; readonly startDate?: string | undefined; readonly endDate?: string | undefined };
  readonly schoolId?: string | undefined;
}
