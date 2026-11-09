import type { AuthorizationPolicyRegistry, AuthorizationResolvers } from '../../../12-authorization-engine/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { CollectorService } from './collector-service';
import type { SubscriptionService } from './subscription-service';

/** Permissions of subscriptions and Collector assignment (registered ONLY through the shared Authorization Engine). */
export const SubscriptionPermissions = {
  CREATE_MONTHLY: 'subscriptions.monthly.create',
  CREATE_INDIVIDUAL: 'subscriptions.subscription.create',
  LIST: 'subscriptions.subscription.list',
  READ: 'subscriptions.subscription.read',
  WAIVE: 'subscriptions.subscription.waive',
  COLLECTOR_ASSIGN: 'subscriptions.collector.assign',
  COLLECTOR_LIST: 'subscriptions.collector.list',
  COLLECTOR_REMOVE: 'subscriptions.collector.remove',
  COLLECTOR_READ_OWN: 'subscriptions.collector.read-own',
} as const;

/** Scope target types owned by Module 33. The SCHOOL target type belongs to Module 16 (its resolver only knows managers), so the subscription routes use their own. */
export const SUBSCRIPTION_SCHOOL_TARGET_TYPE = 'SUBSCRIPTION_SCHOOL';
export const SUBSCRIPTION_TARGET_TYPE = 'SUBSCRIPTION';

export interface SubscriptionAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
  readonly resolvers: Pick<AuthorizationResolvers, 'registerScopeResolver'>;
  readonly subscriptions: Pick<SubscriptionService, 'findScopeById'>;
  readonly collectors: Pick<CollectorService, 'isCollectorOfSchool'>;
  readonly schools: Pick<SchoolLookup, 'isSchoolManager'>;
}

/**
 * Module 33 registers what it owns (approved Module 33 rules; anything not listed stays denied):
 *   - SCHOOL_MANAGER: create the monthly subscriptions and an individual one, list and read the subscriptions of THEIR school, WAIVE a subscription of their school, and assign,
 *     list and unassign Subscription Collectors of their school (scope target SCHOOL, resolved by Module 16).
 *   - SUBSCRIPTION_COLLECTOR: create the monthly subscriptions and an individual one, list and read the subscriptions, ONLY for a school they are CURRENTLY linked to
 *     (an ended link grants nothing). A Collector can NOT waive (Master Specification §61) and cannot manage Collectors. They read their own assignments (`/collectors/me`).
 *   - PARENT, TEACHER, STUDENT, ORGANIZATION_MANAGER and MAIN_ADMIN: no subscription permission (deny by default).
 * There is NO permission to mark a subscription PAID: that is the `markPaid` application contract Module 34 will call, never an HTTP operation of this module.
 * The scope resolvers load the school (for a subscription: its school) from the SERVER and answer `true` only on positive proof: the SCHOOL_MANAGER role with an active manager
 * link to that exact school, or the SUBSCRIPTION_COLLECTOR role with an ACTIVE collector link to that exact school. Call once per process.
 */
export function registerSubscriptionAuthorization(deps: SubscriptionAuthorizationDeps): void {
  const both = ['SCHOOL_MANAGER', 'SUBSCRIPTION_COLLECTOR'] as const;
  const manager = ['SCHOOL_MANAGER'] as const;
  deps.policies.register({ code: SubscriptionPermissions.CREATE_MONTHLY, roles: both, scope: 'MANAGEMENT' });
  deps.policies.register({ code: SubscriptionPermissions.CREATE_INDIVIDUAL, roles: both, scope: 'MANAGEMENT' });
  deps.policies.register({ code: SubscriptionPermissions.LIST, roles: both, scope: 'MANAGEMENT' });
  deps.policies.register({ code: SubscriptionPermissions.READ, roles: both, scope: 'MANAGEMENT' });
  deps.policies.register({ code: SubscriptionPermissions.WAIVE, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: SubscriptionPermissions.COLLECTOR_ASSIGN, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: SubscriptionPermissions.COLLECTOR_LIST, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: SubscriptionPermissions.COLLECTOR_REMOVE, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: SubscriptionPermissions.COLLECTOR_READ_OWN, roles: ['SUBSCRIPTION_COLLECTOR'], scope: 'UNSCOPED' });

  const coversSchool = async (userId: string, role: string, schoolId: string): Promise<boolean> => {
    if (role === 'SCHOOL_MANAGER') return deps.schools.isSchoolManager(userId, schoolId);
    if (role === 'SUBSCRIPTION_COLLECTOR') return deps.collectors.isCollectorOfSchool(userId, schoolId);
    return false;
  };

  deps.resolvers.registerScopeResolver('MANAGEMENT', SUBSCRIPTION_SCHOOL_TARGET_TYPE, {
    covers: async ({ userId, role, kind, target }) => {
      if (kind !== 'MANAGEMENT' || target.type !== SUBSCRIPTION_SCHOOL_TARGET_TYPE) return false;
      return coversSchool(userId, role, target.id);
    },
  });
  deps.resolvers.registerScopeResolver('MANAGEMENT', SUBSCRIPTION_TARGET_TYPE, {
    covers: async ({ userId, role, kind, target }) => {
      if (kind !== 'MANAGEMENT' || target.type !== SUBSCRIPTION_TARGET_TYPE) return false;
      const subscription = await deps.subscriptions.findScopeById(target.id);
      if (!subscription) return false;
      return coversSchool(userId, role, subscription.schoolId);
    },
  });
}
