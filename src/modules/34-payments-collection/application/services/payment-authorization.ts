import type { AuthorizationPolicyRegistry, AuthorizationResolvers } from '../../../12-authorization-engine/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { CollectorService } from '../../../33-subscriptions/public';
import type { PaymentService } from './payment-service';

/** Payment permissions (registered ONLY through the shared Authorization Engine). */
export const PaymentPermissions = {
  RECORD: 'payments.payment.record',
  LIST: 'payments.payment.list',
  READ: 'payments.payment.read',
  REVERSE: 'payments.payment.reverse',
} as const;

/** Scope target type owned by Module 34 (a payment; its school is loaded server-side). Recording and listing reuse Module 33's SUBSCRIPTION / SUBSCRIPTION_SCHOOL targets. */
export const PAYMENT_TARGET_TYPE = 'PAYMENT';

export interface PaymentAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
  readonly resolvers: Pick<AuthorizationResolvers, 'registerScopeResolver'>;
  readonly payments: Pick<PaymentService, 'findScopeById'>;
  readonly collectors: Pick<CollectorService, 'isCollectorOfSchool'>;
  readonly schools: Pick<SchoolLookup, 'isSchoolManager'>;
}

/**
 * Module 34 registers what it owns (Master Specification §61; anything not listed stays denied):
 *   - SCHOOL_MANAGER and SUBSCRIPTION_COLLECTOR: record a cash payment, list and read the payments, ONLY for a school they currently manage / are CURRENTLY linked to (an ended Collector
 *     link grants nothing).
 *   - REVERSE: SCHOOL_MANAGER and SUBSCRIPTION_COLLECTOR, each only for a payment of a school they currently manage / are CURRENTLY linked to (owner decision 2026-11-17; no other role).
 *   - PARENT, TEACHER, STUDENT, ORGANIZATION_MANAGER, MAIN_ADMIN: no payment permission (deny by default).
 * The PAYMENT scope resolver loads the payment's school from the SERVER and answers `true` only on positive proof. Call once per process.
 */
export function registerPaymentAuthorization(deps: PaymentAuthorizationDeps): void {
  const both = ['SCHOOL_MANAGER', 'SUBSCRIPTION_COLLECTOR'] as const;
  deps.policies.register({ code: PaymentPermissions.RECORD, roles: both, scope: 'MANAGEMENT' });
  deps.policies.register({ code: PaymentPermissions.LIST, roles: both, scope: 'MANAGEMENT' });
  deps.policies.register({ code: PaymentPermissions.READ, roles: both, scope: 'MANAGEMENT' });
  deps.policies.register({ code: PaymentPermissions.REVERSE, roles: both, scope: 'MANAGEMENT' });

  deps.resolvers.registerScopeResolver('MANAGEMENT', PAYMENT_TARGET_TYPE, {
    covers: async ({ userId, role, kind, target }) => {
      if (kind !== 'MANAGEMENT' || target.type !== PAYMENT_TARGET_TYPE) return false;
      const payment = await deps.payments.findScopeById(target.id);
      if (!payment) return false;
      if (role === 'SCHOOL_MANAGER') return deps.schools.isSchoolManager(userId, payment.schoolId);
      if (role === 'SUBSCRIPTION_COLLECTOR') return deps.collectors.isCollectorOfSchool(userId, payment.schoolId);
      return false;
    },
  });
}
