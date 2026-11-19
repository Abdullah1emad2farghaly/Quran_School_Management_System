import type { PaymentStatusCount, PaymentStatusCountQuery } from '../../../34-payments-collection/public';
import type { SubscriptionStatusCount, SubscriptionStatusCountQuery } from '../../../33-subscriptions/public';

/**
 * Where the PAYMENT report gets its data. Every method is a read through the OWNING module's public contract (Module 38 owns no table, §102);
 * the report has already proven that every school id lies inside the requester's scope before it calls any of them.
 */
export interface PaymentReportSources {
  /** Every school of the organizations (any status). */
  schoolIdsOfOrganizations(organizationIds: readonly string[]): Promise<string[]>;
  subscriptionCounts(query: SubscriptionStatusCountQuery): Promise<SubscriptionStatusCount[]>;
  paymentCounts(query: PaymentStatusCountQuery): Promise<PaymentStatusCount[]>;
  /** The names of the schools that could be read (a school that cannot be read simply has no entry). */
  schoolNames(schoolIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
