import { describe, expect, it } from 'vitest';
import { ReportPeriodService, ReportScopeResolver, type ReportScopeSources } from '../../../src/modules/37-reports-core/public';
import { ReportService, type PaymentReportSources } from '../../../src/modules/38-report-modules/public';

const ORG = 'org-1';
const S1 = 'school-1';
const S2 = 'school-2';
const S3 = 'school-3-other-org';

const clock = { now: () => new Date('2026-11-18T10:00:00Z') };

function build(assignments: { admin?: string[]; manager?: string[]; collector?: string[] } = {}, data: { subs?: unknown[]; pays?: unknown[]; names?: Record<string, string> } = {}) {
  const calls: string[] = [];
  const scopeSources: ReportScopeSources = {
    organizationIdsOfAdmin: async () => assignments.admin ?? [],
    schoolIdsOfManager: async () => assignments.manager ?? [],
    schoolIdsOfCollector: async () => assignments.collector ?? [],
    groupIdsOfTeacher: async () => ['group-1'],
    studentIdsOfParent: async () => ['student-1'],
    geographicAreasOfManager: async () => undefined,
  };
  const queries: Array<{ kind: string; query: unknown }> = [];
  const payments: PaymentReportSources = {
    schoolIdsOfOrganizations: async (ids) => {
      calls.push('organizations');
      return ids.includes(ORG) ? [S1, S2] : [];
    },
    subscriptionCounts: async (query) => {
      calls.push('subscriptions');
      queries.push({ kind: 'subscriptions', query });
      return (data.subs ?? []) as never;
    },
    paymentCounts: async (query) => {
      calls.push('payments');
      queries.push({ kind: 'payments', query });
      return (data.pays ?? []) as never;
    },
    schoolNames: async () => {
      calls.push('names');
      return new Map(Object.entries(data.names ?? {}));
    },
  };
  const service = new ReportService({ scopes: new ReportScopeResolver(scopeSources), periods: new ReportPeriodService({ clock }), payments, attendance: {} as never, memorization: {} as never, revision: {} as never, evaluation: {} as never, clock });
  return { service, calls, queries };
}

const as = (activeRole: string) => ({ userId: 'user-1', activeRole });
const ACROSS = { kind: 'ACROSS_TIME' };

describe('PAYMENT report: who may run it and over what', () => {
  it('Organization Manager: the schools of their organizations; a requested school must be one of them', async () => {
    const { service, queries } = build({ admin: [ORG] });
    await service.paymentReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect((queries[0]!.query as { schoolIds: string[] }).schoolIds).toEqual([S1, S2]);

    const narrowed = build({ admin: [ORG] });
    await narrowed.service.paymentReport(as('ORGANIZATION_MANAGER'), { period: ACROSS, schoolId: S2 });
    expect((narrowed.queries[0]!.query as { schoolIds: string[] }).schoolIds).toEqual([S2]);

    const outside = build({ admin: [ORG] });
    await expect(outside.service.paymentReport(as('ORGANIZATION_MANAGER'), { period: ACROSS, schoolId: S3 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    expect(outside.queries).toEqual([]); // nothing was read for a school outside the scope
  });

  it.each([['SCHOOL_MANAGER'], ['SUBSCRIPTION_COLLECTOR']])('%s: their own schools only', async (role) => {
    const assignment = role === 'SCHOOL_MANAGER' ? { manager: [S1] } : { collector: [S1] };
    const ok = build(assignment);
    await ok.service.paymentReport(as(role), { period: ACROSS });
    expect((ok.queries[0]!.query as { schoolIds: string[] }).schoolIds).toEqual([S1]);
    expect(ok.calls).not.toContain('organizations'); // a school scope never asks for organizations

    const other = build(assignment);
    await expect(other.service.paymentReport(as(role), { period: ACROSS, schoolId: S2 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    expect(other.queries).toEqual([]);
  });

  it.each([['MAIN_ADMIN'], ['TEACHER'], ['PARENT'], ['STUDENT'], ['GOVERNORATE_MANAGER'], ['CENTER_MANAGER'], ['VILLAGE_MANAGER'], ['UNKNOWN_ROLE'], ['']])('%s has no PAYMENT report and nothing is read', async (role) => {
    const { service, calls } = build({ admin: [ORG], manager: [S1], collector: [S1] });
    await expect(service.paymentReport(as(role), { period: ACROSS })).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
    expect(calls).toEqual([]);
  });

  it('a manager or collector with no CURRENT assignment has no report (an empty scope is never "everything")', async () => {
    for (const role of ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER', 'SUBSCRIPTION_COLLECTOR']) {
      const { service, calls } = build();
      await expect(service.paymentReport(as(role), { period: ACROSS })).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
      expect(calls).toEqual([]);
    }
  });
});

describe('PAYMENT report: period', () => {
  const bounds = async (period: { kind: string; startDate?: string; endDate?: string }) => {
    const { service, queries } = build({ manager: [S1] });
    const report = await service.paymentReport(as('SCHOOL_MANAGER'), { period });
    return { report, query: queries[0]!.query as { fromMonth?: string; toMonth?: string } };
  };

  it('ACROSS_TIME has no month bounds', async () => {
    const { query, report } = await bounds(ACROSS);
    expect(query.fromMonth).toBeUndefined();
    expect(query.toMonth).toBeUndefined();
    expect(report.period).toEqual({ kind: 'ACROSS_TIME', startDate: null, endDate: null });
  });

  it('THIS_MONTH, LAST_MONTH and CUSTOM are bounded by the months of their first and last business dates', async () => {
    expect((await bounds({ kind: 'THIS_MONTH' })).query).toMatchObject({ fromMonth: '2026-11', toMonth: '2026-11' });
    expect((await bounds({ kind: 'LAST_MONTH' })).query).toMatchObject({ fromMonth: '2026-10', toMonth: '2026-10' });
    expect((await bounds({ kind: 'CUSTOM', startDate: '2026-09-15', endDate: '2026-11-02' })).query).toMatchObject({ fromMonth: '2026-09', toMonth: '2026-11' });
  });

  it('an invalid period is refused before anything is read', async () => {
    for (const period of [{ kind: 'FOREVER' }, { kind: 'CUSTOM' }, { kind: 'THIS_MONTH', startDate: '2026-10-01' }, { kind: 'CUSTOM', startDate: '2026-10-31', endDate: '2026-10-01' }]) {
      const { service, calls } = build({ manager: [S1] });
      await expect(service.paymentReport(as('SCHOOL_MANAGER'), { period })).rejects.toMatchObject({ kind: 'VALIDATION' });
      expect(calls).toEqual([]);
    }
  });
});

describe('PAYMENT report: the numbers', () => {
  it('combines subscription statuses and payments per school and month, sorted by school name then month, with totals and history kept', async () => {
    const { service } = build(
      { manager: [S1, S2] },
      {
        names: { [S1]: 'مدرسة ب', [S2]: 'مدرسة أ' },
        subs: [
          { schoolId: S1, month: '2026-11', status: 'UNPAID', count: 2 },
          { schoolId: S1, month: '2026-10', status: 'PAID', count: 3 },
          { schoolId: S1, month: '2026-10', status: 'WAIVED', count: 1 },
          { schoolId: S2, month: '2026-11', status: 'PAID', count: 5 },
        ],
        pays: [
          { schoolId: S1, month: '2026-10', status: 'SUCCESSFUL', count: 3 },
          { schoolId: S1, month: '2026-10', status: 'REVERSED', count: 1 },
          { schoolId: S2, month: '2026-11', status: 'SUCCESSFUL', count: 5 },
        ],
      },
    );
    const report = await service.paymentReport(as('SCHOOL_MANAGER'), { period: ACROSS });
    expect(report.type).toBe('PAYMENT');
    expect(report.generatedAt).toBe('2026-11-18T10:00:00.000Z');
    expect(report.rows.map((r) => `${r.schoolName}|${r.month}`)).toEqual(['مدرسة أ|2026-11', 'مدرسة ب|2026-10', 'مدرسة ب|2026-11']);
    expect(report.rows[1]).toEqual({ schoolId: S1, schoolName: 'مدرسة ب', month: '2026-10', paid: 3, unpaid: 0, waived: 1, subscriptions: 4, paymentsRecorded: 3, paymentsReversed: 1 });
    expect(report.totals).toEqual({ paid: 8, unpaid: 2, waived: 1, subscriptions: 11, paymentsRecorded: 8, paymentsReversed: 1 });
  });

  it('a payment without a subscription row still shows (history is never hidden) and an unreadable school has a null name', async () => {
    const { service } = build({ manager: [S1] }, { pays: [{ schoolId: S1, month: '2026-09', status: 'REVERSED', count: 2 }] });
    const report = await service.paymentReport(as('SCHOOL_MANAGER'), { period: ACROSS });
    expect(report.rows).toEqual([{ schoolId: S1, schoolName: null, month: '2026-09', paid: 0, unpaid: 0, waived: 0, subscriptions: 0, paymentsRecorded: 0, paymentsReversed: 2 }]);
  });

  it('an empty scope-covered period is an empty report with zero totals', async () => {
    const { service } = build({ manager: [S1] });
    const report = await service.paymentReport(as('SCHOOL_MANAGER'), { period: ACROSS });
    expect(report.rows).toEqual([]);
    expect(report.totals).toEqual({ paid: 0, unpaid: 0, waived: 0, subscriptions: 0, paymentsRecorded: 0, paymentsReversed: 0 });
  });
});
