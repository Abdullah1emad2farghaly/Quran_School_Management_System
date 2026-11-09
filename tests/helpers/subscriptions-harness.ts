import {
  CollectorService,
  InMemoryCollectorLinkRepository,
  InMemorySubscriptionRepository,
  PublicStudentRoster,
  SubscriptionService,
  registerSubscriptionAuthorization,
} from '../../src/modules/33-subscriptions/public';
import { createStudentsHarness } from './students-harness';

/** Mid-month Cairo noon: 2026-11-10 11:00 Cairo (UTC+2). */
export const DEFAULT_NOW = '2026-11-10T09:00:00Z';
export const COLLECTOR_NAME = 'محمود سعيد علي';

/**
 * In-memory wiring of Modules 08-10, 12, 13-19 (the Students harness: real sessions, real Authorization Engine, real Parent/Teacher/Student services) plus Module 33
 * (subscriptions and Subscription Collectors). The Module 33 clock is separately controllable (`setNow`) so month boundaries in Africa/Cairo can be tested; its unit of
 * work rolls the subscription stores back together with everything else when the work throws.
 */
export async function createSubscriptionsHarness() {
  const subscriptionRepo = new InMemorySubscriptionRepository();
  const collectorLinks = new InMemoryCollectorLinkRepository();
  const t = await createStudentsHarness({ extraStores: [subscriptionRepo, collectorLinks] });

  let current = new Date(DEFAULT_NOW);
  const clock = { now: () => current };
  const setNow = (iso: string): void => {
    current = new Date(iso);
  };

  const subscriptions = new SubscriptionService({
    subscriptions: subscriptionRepo,
    roster: new PublicStudentRoster(t.students),
    schools: t.service,
    unitOfWork: t.unitOfWork,
    outbox: t.h.outbox,
    clock,
  });
  const collectors = new CollectorService({
    links: collectorLinks,
    schools: t.service,
    identity: t.h.identity,
    roles: t.h.roles,
    parents: t.parents,
    teachers: t.teachers,
    unitOfWork: t.unitOfWork,
    outbox: t.h.outbox,
    clock,
  });
  registerSubscriptionAuthorization({ policies: t.policies, resolvers: t.resolvers, subscriptions, collectors, schools: t.service });

  let phone = 5000;
  /** A fresh ACTIVE student of `schoolId` (with its own Parent), registered by `managerId`. */
  const newStudent = async (schoolId: string, managerId: string) => {
    const parent = await t.newParent(schoolId, managerId);
    return t.registerStudent(schoolId, parent.id, managerId);
  };
  /** A Subscription Collector registered by the school's manager (a new account), with its login phone and initial password. */
  const newCollector = async (schoolId: string, managerId: string, name = COLLECTOR_NAME) => {
    phone += 1;
    const local = `0102000${phone}`;
    const result = await collectors.registerCollector({ schoolId, name, phone: local }, managerId);
    return { ...result, phone: local, password: local.slice(-4) };
  };
  const events = (type?: string) => t.h.store.messages.filter((m) => m.aggregateType.startsWith('Subscription') || m.aggregateType === 'CollectorSchoolLink').filter((m) => !type || m.eventType === type);

  return { ...t, subscriptionRepo, collectorLinks, subscriptions, collectors, setNow, clock, newStudent, newCollector, events };
}
