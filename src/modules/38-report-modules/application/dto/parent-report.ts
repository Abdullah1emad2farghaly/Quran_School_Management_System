import type { ReportPeriodDto } from './payment-report';
import type { StudentReport } from './student-report';

/** What a client may ask of the PARENT report. A manager MUST send `parentId`; a Parent may omit it (their own account) and may never name anyone else. */
export interface ParentReportRequest {
  readonly period: { readonly kind: string; readonly startDate?: string | undefined; readonly endDate?: string | undefined };
  readonly parentId?: string | undefined;
}

/** A child in the Parent header: the name only (no lifecycle status, no school detail beyond what each child's report carries). */
export interface ParentReportChildRef {
  readonly id: string;
  readonly name: string | null;
}

/** The Parent header: the name and the list of ALL the authorized children (never a phone number or an address). */
export interface ParentReportParent {
  readonly id: string;
  readonly name: string;
  readonly children: readonly ParentReportChildRef[];
}

/**
 * The report of ONE Parent (Master Specification §68: "Parent reports include all linked children with separate context"). Each child has its OWN complete STUDENT report (`childReports`: the same sections,
 * the same rules, every exam in full; the subscription section only for the Organization Manager and the School Manager). `parent.children` lists EVERY authorized child; `childReports` holds only the children
 * of the requested page (the ONLY pagination of this report; files hold every child).
 */
export interface ParentReport {
  readonly type: 'PARENT';
  readonly period: ReportPeriodDto;
  /** When the report was produced (UTC ISO). */
  readonly generatedAt: string;
  readonly parent: ParentReportParent;
  readonly childReports: readonly StudentReport[];
}
