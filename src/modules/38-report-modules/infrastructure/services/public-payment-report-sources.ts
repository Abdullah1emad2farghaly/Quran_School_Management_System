import type { PaymentLookup } from '../../../34-payments-collection/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { SubscriptionLookup } from '../../../33-subscriptions/public';
import type { PaymentReportSources } from '../../application/ports/payment-report-sources';

export interface PublicPaymentReportSourcesDeps {
  readonly schools: Pick<SchoolLookup, 'findById' | 'listSchoolIdsOfOrganizations'>;
  readonly subscriptions: Pick<SubscriptionLookup, 'countStatusesForReport'>;
  readonly payments: Pick<PaymentLookup, 'countPaymentsForReport'>;
}

/** The PAYMENT report's data, read ONLY through the public contracts of Modules 16, 33 and 34 (never their tables or repositories). */
export class PublicPaymentReportSources implements PaymentReportSources {
  constructor(private readonly deps: PublicPaymentReportSourcesDeps) {}

  schoolIdsOfOrganizations(organizationIds: readonly string[]) {
    return this.deps.schools.listSchoolIdsOfOrganizations(organizationIds);
  }

  subscriptionCounts(query: Parameters<PaymentReportSources['subscriptionCounts']>[0]) {
    return this.deps.subscriptions.countStatusesForReport(query);
  }

  paymentCounts(query: Parameters<PaymentReportSources['paymentCounts']>[0]) {
    return this.deps.payments.countPaymentsForReport(query);
  }

  async schoolNames(schoolIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const names = new Map<string, string>();
    for (const id of new Set(schoolIds)) {
      const school = await this.deps.schools.findById(id);
      if (school) names.set(id, school.name);
    }
    return names;
  }
}
