import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  CollectorService,
  PublicSchoolGroupRoster,
  PublicStudentRoster,
  SequelizeCollectorLinkRepository,
  SequelizeSubscriptionRepository,
  SubscriptionGroupService,
  SubscriptionPaymentTransitions,
  SubscriptionService,
  registerSubscriptionAuthorization,
} from '../modules/33-subscriptions/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getGroupService } from './groups';
import { getIdentityService } from './identity';
import { getOutboxService } from './outbox';
import { getParentService } from './parents';
import { getRoleService } from './roles';
import { getSchoolService } from './schools';
import { getStudentService } from './students';
import { getTeacherService } from './teachers';

let collectors: CollectorService | undefined;
let subscriptions: SubscriptionService | undefined;
let paymentTransitions: SubscriptionPaymentTransitions | undefined;
let groupSummaries: SubscriptionGroupService | undefined;

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
 * Inject into other modules read-only (`SubscriptionLookup`). It has NO payment operation: PAID <-> UNPAID transitions are reachable only through `getSubscriptionPaymentTransitions()`,
 * which is given to Module 34's payment workflow alone. Writes over HTTP are protected at the routes by the Authorization Engine.
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

/**
 * The controlled internal contract that moves a subscription between UNPAID and PAID (approved: Module 34 exclusively owns those transitions). It is not an HTTP operation and must be
 * injected ONLY into Module 34's payment workflow (an architecture test checks who imports it).
 */
export function getSubscriptionPaymentTransitions(): SubscriptionPaymentTransitions {
  if (!paymentTransitions) {
    paymentTransitions = new SubscriptionPaymentTransitions({
      subscriptions: new SequelizeSubscriptionRepository(getSequelize()),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return paymentTransitions;
}

/** Read-only group-based subscription statistics (reads Module 20's groups through its public service; creates and stores no group data). */
export function getSubscriptionGroupService(): SubscriptionGroupService {
  if (!groupSummaries) {
    groupSummaries = new SubscriptionGroupService({
      subscriptions: new SequelizeSubscriptionRepository(getSequelize()),
      groups: new PublicSchoolGroupRoster(getGroupService()),
      schools: getSchoolService(),
      unitOfWork: getUnitOfWork(),
      clock: new SystemClock(),
    });
  }
  return groupSummaries;
}

/** Subscription permissions and the two scope resolvers are registered ONCE, when this module is loaded, through the shared Authorization Engine. */
registerSubscriptionAuthorization({
  policies: getAuthorizationPolicyRegistry(),
  resolvers: getAuthorizationResolvers(),
  subscriptions: { findScopeById: (id) => getSubscriptionService().findScopeById(id) },
  collectors: { isCollectorOfSchool: (userId, schoolId) => getCollectorService().isCollectorOfSchool(userId, schoolId) },
  schools: { isSchoolManager: (userId, schoolId) => getSchoolService().isSchoolManager(userId, schoolId) },
});
