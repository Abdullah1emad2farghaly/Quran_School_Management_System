import { SystemClock } from '../modules/00-shared-kernel/public';
import { PaymentService, SequelizePaymentRepository, registerPaymentAuthorization } from '../modules/34-payments-collection/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getOutboxService } from './outbox';
import { getSchoolService } from './schools';
import { getCollectorService, getSubscriptionPaymentTransitions } from './subscriptions';

let payments: PaymentService | undefined;

/**
 * Payments & Collection (Module 34). Module 34 owns the whole payment lifecycle. Recording and reversing a payment change the subscription ONLY through Module 33's controlled contract (`SubscriptionPaymentTransitions`:
 * `applyPaymentRecorded` / `applyPaymentReversed`), in the payment's own transaction. Writes over HTTP are protected at the routes by the Authorization Engine.
 */
export function getPaymentService(): PaymentService {
  if (!payments) {
    payments = new PaymentService({
      payments: new SequelizePaymentRepository(getSequelize()),
      subscriptions: getSubscriptionPaymentTransitions(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return payments;
}

/** Payment permissions and the PAYMENT scope resolver are registered ONCE, when this module is loaded, through the shared Authorization Engine. */
registerPaymentAuthorization({
  policies: getAuthorizationPolicyRegistry(),
  resolvers: getAuthorizationResolvers(),
  payments: { findScopeById: (id) => getPaymentService().findScopeById(id) },
  collectors: { isCollectorOfSchool: (userId, schoolId) => getCollectorService().isCollectorOfSchool(userId, schoolId) },
  schools: { isSchoolManager: (userId, schoolId) => getSchoolService().isSchoolManager(userId, schoolId) },
});
