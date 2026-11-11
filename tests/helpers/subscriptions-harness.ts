import { GroupService, InMemoryGroupRepository } from '../../src/modules/20-groups/public';
import {
  CollectorService,
  InMemoryCollectorLinkRepository,
  InMemorySubscriptionRepository,
  PublicSchoolGroupRoster,
  PublicStudentRoster,
  SubscriptionGroupService,
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
  const groupRepo = new InMemoryGroupRepository();
  const t = await createStudentsHarness({ extraStores: [subscriptionRepo, collectorLinks, groupRepo] });

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
  // The REAL Module 20 groups (in-memory store): Module 33 reads them only through the public GroupService.
  const groups = new GroupService({ groups: groupRepo, schools: t.service, teachers: t.teachers, students: t.students, unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: t.h.clock });
  const groupSummaries = new SubscriptionGroupService({ subscriptions: subscriptionRepo, groups: new PublicSchoolGroupRoster(groups), schools: t.service, unitOfWork: t.unitOfWork, clock });
  let groupCounter = 0;
  /** A new ACTIVE group of the school (created by its manager). */
  const newGroup = (schoolId: string, managerId: string, name = `حلقة ${++groupCounter}`) => groups.createGroup({ schoolId, name, learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78 } as never, managerId);
  /** A new ACTIVE student of the school, assigned to `groupId` (the school manager does both). */
  const newStudentInGroup = async (schoolId: string, managerId: string, groupId: string) => {
    const student = await newStudentOf(schoolId, managerId);
    await groups.assignStudent(groupId, student.id, managerId);
    return student;
  };
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
  const newStudentOf = async (schoolId: string, managerId: string) => {
    const parent = await t.newParent(schoolId, managerId);
    return t.registerStudent(schoolId, parent.id, managerId);
  };
  const newStudent = newStudentOf;
  /** A Subscription Collector registered by the school's manager (a new account), with its login phone and initial password. */
  const newCollector = async (schoolId: string, managerId: string, name = COLLECTOR_NAME) => {
    phone += 1;
    const local = `0102000${phone}`;
    const result = await collectors.registerCollector({ schoolId, name, phone: local }, managerId);
    return { ...result, phone: local, password: local.slice(-4) };
  };
  const events = (type?: string) => t.h.store.messages.filter((m) => m.aggregateType.startsWith('Subscription') || m.aggregateType === 'CollectorSchoolLink').filter((m) => !type || m.eventType === type);

  return { ...t, subscriptionRepo, collectorLinks, groupRepo, groups, groupSummaries, newGroup, newStudentInGroup, subscriptions, collectors, setNow, clock, newStudent, newCollector, events };
}
