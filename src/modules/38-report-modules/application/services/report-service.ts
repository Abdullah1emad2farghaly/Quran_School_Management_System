import { SystemClock, type Clock } from '../../../00-shared-kernel/public';
import { ReportPeriodService, ReportScopeResolver, authorizeRequestedIds, reportError, restrictToScope, type ReportRequester } from '../../../37-reports-core/public';
import type { PaymentReport, PaymentReportRequest, PaymentReportRow, PaymentReportTotals } from '../dto/payment-report';
import type { PaymentReportSources } from '../ports/payment-report-sources';

export interface ReportServiceDeps {
  readonly scopes: ReportScopeResolver;
  readonly periods: ReportPeriodService;
  readonly payments: PaymentReportSources;
  readonly clock?: Clock;
}

const monthOf = (date: string | null): string | undefined => (date === null ? undefined : date.slice(0, 7));

/**
 * The report catalog (Master Specification §68). Slice 1 holds the PAYMENT report. Every report follows the same chain, in this order, with NOTHING read before it succeeds:
 *   1. `ReportScopeResolver.authorize`: the role may run this report type AND has a current, non-empty scope (REPORT_NOT_ALLOWED otherwise);
 *   2. the period is resolved by Module 37 (§66);
 *   3. the requested filters are checked against the scope (`restrictToScope` / `authorizeRequestedIds`: REPORT_SCOPE_FORBIDDEN, never revealing whether an id exists);
 *   4. only then is data read, through the owning modules' public contracts.
 * The requester always comes from the verified session, never from the request.
 */
export class ReportService {
  private readonly clock: Clock;

  constructor(private readonly deps: ReportServiceDeps) {
    this.clock = deps.clock ?? new SystemClock();
  }

  /**
   * PAYMENT report: subscription statuses and payments per school and billing month (cash only, no amount).
   * A billing month is included when it lies inside the period (months of the period's first and last business dates, inclusive); ACROSS_TIME has no bounds.
   * Available to the Organization Manager (their organizations' schools), the School Manager (their schools) and the Subscription Collector (their currently linked schools).
   */
  async paymentReport(requester: ReportRequester, request: PaymentReportRequest): Promise<PaymentReport> {
    const scope = await this.deps.scopes.authorize(requester, 'PAYMENT');
    const period = this.deps.periods.resolvePeriod(request.period);
    const targets = restrictToScope(scope, request.schoolId !== undefined ? { schoolIds: [request.schoolId] } : {});

    let schoolIds: string[];
    if (scope.kind === 'ORGANIZATIONS') {
      const ofOrganizations = await this.deps.payments.schoolIdsOfOrganizations(targets.allowedIds);
      schoolIds = authorizeRequestedIds(targets.mustBeContained.schoolIds, ofOrganizations);
    } else if (scope.kind === 'SCHOOLS') {
      schoolIds = [...targets.allowedIds];
    } else {
      throw reportError('REPORT_NOT_ALLOWED');
    }

    const fromMonth = monthOf(period.startDate);
    const toMonth = monthOf(period.endDate);
    const bounds = { schoolIds, ...(fromMonth !== undefined ? { fromMonth } : {}), ...(toMonth !== undefined ? { toMonth } : {}) };
    const [subscriptionCounts, paymentCounts, names] = await Promise.all([
      this.deps.payments.subscriptionCounts(bounds),
      this.deps.payments.paymentCounts(bounds),
      this.deps.payments.schoolNames(schoolIds),
    ]);

    const rows = new Map<string, { schoolId: string; month: string; paid: number; unpaid: number; waived: number; paymentsRecorded: number; paymentsReversed: number }>();
    const rowOf = (schoolId: string, month: string) => {
      const key = `${schoolId}|${month}`;
      let row = rows.get(key);
      if (!row) {
        row = { schoolId, month, paid: 0, unpaid: 0, waived: 0, paymentsRecorded: 0, paymentsReversed: 0 };
        rows.set(key, row);
      }
      return row;
    };
    for (const c of subscriptionCounts) {
      const row = rowOf(c.schoolId, c.month);
      if (c.status === 'PAID') row.paid += c.count;
      else if (c.status === 'UNPAID') row.unpaid += c.count;
      else row.waived += c.count;
    }
    for (const c of paymentCounts) {
      const row = rowOf(c.schoolId, c.month);
      if (c.status === 'SUCCESSFUL') row.paymentsRecorded += c.count;
      else row.paymentsReversed += c.count;
    }

    const ordered: PaymentReportRow[] = [...rows.values()]
      .map((r) => ({ ...r, schoolName: names.get(r.schoolId) ?? null, subscriptions: r.paid + r.unpaid + r.waived }))
      .sort((a, b) => {
        const byName = (a.schoolName ?? '').localeCompare(b.schoolName ?? '');
        if (byName !== 0) return byName;
        if (a.schoolId !== b.schoolId) return a.schoolId < b.schoolId ? -1 : 1;
        return a.month < b.month ? -1 : a.month > b.month ? 1 : 0;
      });

    const totals: PaymentReportTotals = ordered.reduce(
      (sum, r) => ({
        paid: sum.paid + r.paid,
        unpaid: sum.unpaid + r.unpaid,
        waived: sum.waived + r.waived,
        subscriptions: sum.subscriptions + r.subscriptions,
        paymentsRecorded: sum.paymentsRecorded + r.paymentsRecorded,
        paymentsReversed: sum.paymentsReversed + r.paymentsReversed,
      }),
      { paid: 0, unpaid: 0, waived: 0, subscriptions: 0, paymentsRecorded: 0, paymentsReversed: 0 },
    );

    return {
      type: 'PAYMENT',
      period: { kind: period.kind, startDate: period.startDate, endDate: period.endDate },
      generatedAt: this.clock.now().toISOString(),
      rows: ordered,
      totals,
    };
  }
}
