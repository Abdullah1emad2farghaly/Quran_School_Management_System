import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  CollectorService,
  PublicStudentRoster,
  SequelizeCollectorLinkRepository,
  SequelizeSubscriptionRepository,
  SubscriptionService,
  registerSubscriptionAuthorization,
} from '../modules/33-subscriptions/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getIdentityService } from './identity';
import { getOutboxService } from './outbox';
import { getParentService } from './parents';
import { getRoleService } from './roles';
import { getSchoolService } from './schools';
import { getStudentService } from './students';
import { getTeacherService } from './teachers';

let collectors: CollectorService | undefined;
let subscriptions: SubscriptionService | undefined;

/**
 * Inject into other modules read-only (`CollectorDirectory`). Collector accounts are created and matched with the same identity rules as Teachers
 * (the canonical three-part name stored on the account itself, `users.full_name`, Module 08).
 */
export function getCollectorService(): CollectorService {
  if (!collectors) {
    collectors = new CollectorService({
      links: new SequelizeCollectorLinkRepository(getSequelize()),
      schools: getSchoolService(),
      identity: getIdentityService(),
      roles: getRoleService(),
      parents: getParentService(),
      teachers: getTeacherService(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return collectors;
}

/**
 * Inject into other modules read-only (`SubscriptionLookup`); Module 34 (Payments) will receive it as `SubscriptionPayments` (`markPaid`).
 * Writes over HTTP are protected at the routes by the Authorization Engine; `markPaid` is deliberately not an HTTP operation.
 */
export function getSubscriptionService(): SubscriptionService {
  if (!subscriptions) {
    subscriptions = new SubscriptionService({
      subscriptions: new SequelizeSubscriptionRepository(getSequelize()),
      roster: new PublicStudentRoster(getStudentService()),
      schools: getSchoolService(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return subscriptions;
}

/** Subscription permissions and the two scope resolvers are registered ONCE, when this module is loaded, through the shared Authorization Engine. */
registerSubscriptionAuthorization({
  policies: getAuthorizationPolicyRegistry(),
  resolvers: getAuthorizationResolvers(),
  subscriptions: { findScopeById: (id) => getSubscriptionService().findScopeById(id) },
  collectors: { isCollectorOfSchool: (userId, schoolId) => getCollectorService().isCollectorOfSchool(userId, schoolId) },
  schools: { isSchoolManager: (userId, schoolId) => getSchoolService().isSchoolManager(userId, schoolId) },
});
