import type { DomainEvent } from '../../src/modules/00-shared-kernel/public';
import type { EventHandler } from '../../src/modules/06-domain-events-outbox/public';
import {
  InMemoryRuleStateRepository,
  ReminderProcessor,
  createAssignmentChangeHandler,
  createEvaluationHandler,
  createExamEventHandlers,
  createGroupChangeHandlers,
  createSchoolRequestHandlers,
  createSessionReminderHandlers,
  createSubscriptionRuleHandlers,
  registerRuleTemplates,
  type AssignmentDirectory,
  type AssignmentKind,
  type AssignmentTexts,
  type AyahLocation,
  type QuranDirectory,
  type RangeSnapshot,
  type ExamDirectory,
  type ExamInfo,
  type GroupDirectory,
  type GroupInfo,
  type RuleDeps,
  type SchoolDirectory,
  type SchoolInfo,
  type SessionActivityView,
  type SessionEvaluationView,
  type SessionReads,
  type StudentDirectory,
  type StudentInfo,
  type SubscriptionBatchInfo,
  type SubscriptionDirectory,
  type SubscriptionInfo,
  type TeacherDirectory,
} from '../../src/modules/32-notification-rules/public';
import { createNotificationHarness } from './notification-harness';

export const ids = {
  org: '00000000-0000-4000-8000-0000000000a1',
  school: '00000000-0000-4000-8000-0000000000b1',
  manager1: '00000000-0000-4000-8000-0000000000c1',
  manager2: '00000000-0000-4000-8000-0000000000c2',
  applicant: '00000000-0000-4000-8000-0000000000c3',
  teacherUser1: '00000000-0000-4000-8000-0000000000d1',
  teacherUser2: '00000000-0000-4000-8000-0000000000d2',
  teacherUser3: '00000000-0000-4000-8000-0000000000d3',
  teacher1: '00000000-0000-4000-8000-0000000000e1',
  teacher2: '00000000-0000-4000-8000-0000000000e2',
  teacher3: '00000000-0000-4000-8000-0000000000e3',
  parentA: '00000000-0000-4000-8000-0000000000f1',
  parentA2: '00000000-0000-4000-8000-0000000000f2',
  parentB: '00000000-0000-4000-8000-0000000000f3',
  studentA: '00000000-0000-4000-8000-000000000011',
  studentA2: '00000000-0000-4000-8000-000000000012',
  studentB: '00000000-0000-4000-8000-000000000013',
  group1: '00000000-0000-4000-8000-000000000021',
  group2: '00000000-0000-4000-8000-000000000022',
  exam: '00000000-0000-4000-8000-000000000031',
  session: '00000000-0000-4000-8000-000000000041',
  session2: '00000000-0000-4000-8000-000000000042',
};

export const MIN = 60_000;
export const HOUR = 60 * MIN;

/** Mutable fakes of the read ports: a test arranges the world, then delivers events. */
export class FakeStudents implements StudentDirectory {
  readonly map = new Map<string, StudentInfo>();
  async find(id: string): Promise<StudentInfo | undefined> {
    return this.map.get(id);
  }
}
export class FakeTeachers implements TeacherDirectory {
  readonly map = new Map<string, string>();
  async userIdOf(id: string): Promise<string | undefined> {
    return this.map.get(id);
  }
}
export class FakeGroups implements GroupDirectory {
  readonly map = new Map<string, GroupInfo>();
  readonly members = new Map<string, string[]>();
  async find(id: string): Promise<GroupInfo | undefined> {
    return this.map.get(id);
  }
  async listStudentIds(id: string): Promise<string[]> {
    return [...(this.members.get(id) ?? [])];
  }
}
export class FakeSchools implements SchoolDirectory {
  readonly map = new Map<string, SchoolInfo>();
  readonly managers = new Map<string, string[]>();
  async find(id: string): Promise<SchoolInfo | undefined> {
    return this.map.get(id);
  }
  async organizationManagerUserIds(orgId: string): Promise<string[]> {
    return [...(this.managers.get(orgId) ?? [])];
  }
}
/** Mutable fake of the Module 33 read port: a test arranges subscriptions, batches, collectors and the school manager. */
export class FakeSubscriptions implements SubscriptionDirectory {
  readonly subscriptions = new Map<string, SubscriptionInfo>();
  readonly batches = new Map<string, SubscriptionBatchInfo>();
  /** subscription ids by batch id */
  readonly batchMembers = new Map<string, string[]>();
  readonly collectors = new Map<string, string[]>();
  readonly managers = new Map<string, string[]>();
  async find(id: string): Promise<SubscriptionInfo | undefined> {
    return this.subscriptions.get(id);
  }
  async findBatch(id: string): Promise<SubscriptionBatchInfo | undefined> {
    return this.batches.get(id);
  }
  async listOfBatch(batchId: string): Promise<SubscriptionInfo[]> {
    return (this.batchMembers.get(batchId) ?? []).map((id) => this.subscriptions.get(id)!).filter(Boolean);
  }
  async listUnpaidOfSchoolMonth(schoolId: string, month: string): Promise<SubscriptionInfo[]> {
    return [...this.subscriptions.values()].filter((s) => s.schoolId === schoolId && s.month === month && s.status === 'UNPAID');
  }
  async collectorUserIds(schoolId: string): Promise<string[]> {
    return [...(this.collectors.get(schoolId) ?? [])];
  }
  async schoolManagerUserIds(schoolId: string): Promise<string[]> {
    return [...(this.managers.get(schoolId) ?? [])];
  }
}
export class FakeExams implements ExamDirectory {
  readonly map = new Map<string, ExamInfo>();
  /** The live targets while the exam is DRAFT/SCHEDULED; undefined once it is not live. */
  readonly targets = new Map<string, string[]>();
  async find(id: string): Promise<ExamInfo | undefined> {
    return this.map.get(id);
  }
  async listLiveTargetStudentIds(id: string): Promise<string[] | undefined> {
    const info = this.map.get(id);
    if (!info || (info.status !== 'DRAFT' && info.status !== 'SCHEDULED')) return undefined;
    return [...(this.targets.get(id) ?? [])];
  }
}
export class FakeSessions implements SessionReads {
  readonly evaluation = new Map<string, SessionEvaluationView>();
  readonly activity = new Map<string, SessionActivityView>();
  readonly texts = new Map<string, AssignmentTexts>();
  failTexts = false;
  failEvaluation = false;
  async evaluationStatus(id: string): Promise<SessionEvaluationView | undefined> {
    if (this.failEvaluation) throw new Error('evaluation read failed');
    return this.evaluation.get(id);
  }
  async activities(id: string): Promise<SessionActivityView | undefined> {
    return this.activity.get(id);
  }
  async assignmentTexts(sessionId: string, studentId: string): Promise<AssignmentTexts> {
    if (this.failTexts) throw new Error('assignment read failed');
    return this.texts.get(`${sessionId}|${studentId}`) ?? {};
  }
}

/** `en` (default) renders every notification in English so the tests read naturally; `default` uses the real resolver, which renders Arabic (no account language exists yet). */
export class FakeAssignments implements AssignmentDirectory {
  readonly map = new Map<string, RangeSnapshot>();
  failing = false;
  async find(kind: AssignmentKind, id: string): Promise<RangeSnapshot | undefined> {
    if (this.failing) throw new Error('assignment read failed');
    return this.map.get(`${kind}|${id}`);
  }
}
/** A tiny Quran: surahs 1 (Al-Fatiha) and 2 (Al-Baqarah) with fixed pages and quarters. */
export class FakeQuran implements QuranDirectory {
  readonly names = new Map<number, string>([[1, 'الفاتحة'], [2, 'البقرة'], [3, 'آل عمران']]);
  readonly locations = new Map<string, AyahLocation>();
  async surahName(n: number): Promise<string> {
    return this.names.get(n) ?? String(n);
  }
  async ayahLocation(surah: number, ayah: number): Promise<AyahLocation | undefined> {
    return this.locations.get(`${surah}:${ayah}`);
  }
}

export function createRulesHarness(options: { language?: 'en' | 'default' } = {}) {
  const h = createNotificationHarness({ pushEnabled: false, ...(options.language === 'default' ? {} : { language: { languageOf: async () => 'en' as const } }) });
  registerRuleTemplates(h.templates);
  const students = new FakeStudents();
  const teachers = new FakeTeachers();
  const groups = new FakeGroups();
  const schools = new FakeSchools();
  const exams = new FakeExams();
  const sessions = new FakeSessions();
  const assignments = new FakeAssignments();
  const quran = new FakeQuran();
  const subscriptions = new FakeSubscriptions();
  const state = new InMemoryRuleStateRepository();
  const deps: RuleDeps = { notifications: h.service, templates: h.templates, students, teachers, groups, schools, exams, sessions, assignments, quran, subscriptions, state, unitOfWork: h.unitOfWork, clock: h.clock };
  const handlers: EventHandler[] = [
    ...createSchoolRequestHandlers(deps),
    ...createGroupChangeHandlers(deps),
    createAssignmentChangeHandler(deps),
    ...createExamEventHandlers(deps),
    createEvaluationHandler(deps),
    ...createSessionReminderHandlers(deps),
    ...createSubscriptionRuleHandlers(deps),
  ];
  const processor = new ReminderProcessor(deps);

  let seq = 0;
  const makeEvent = (eventType: string, payload: unknown, eventId?: string): DomainEvent => {
    seq += 1;
    return { eventId: eventId ?? `evt-${seq}`, eventType, occurredAt: h.clock.now(), aggregateType: 'Test', aggregateId: 'agg', payload };
  };
  /** Delivers one event to every consumer of its type, in registration order, as the outbox would (an error propagates so a test can assert it). */
  const deliver = async (eventType: string, payload: unknown, eventId?: string): Promise<DomainEvent> => {
    const event = makeEvent(eventType, payload, eventId);
    for (const handler of handlers) if (handler.eventTypes.includes(eventType)) await handler.handle(event);
    return event;
  };
  /** Redelivers the SAME event (the outbox is at-least-once). */
  const redeliver = async (event: DomainEvent): Promise<void> => {
    for (const handler of handlers) if (handler.eventTypes.includes(event.eventType)) await handler.handle(event);
  };
  const notificationsOf = (userId: string) => [...h.repository.notifications.values()].filter((n) => n.recipientUserId === userId);
  const allNotifications = () => [...h.repository.notifications.values()];

  // A default world: one school, two groups, three students (A and A2 belong to parent A; B to parent B), one teacher per group.
  students.map.set(ids.studentA, { id: ids.studentA, fullName: 'Ali Ahmed', schoolId: ids.school, parentUserIds: [ids.parentA] });
  students.map.set(ids.studentA2, { id: ids.studentA2, fullName: 'Amal Ahmed', schoolId: ids.school, parentUserIds: [ids.parentA] });
  students.map.set(ids.studentB, { id: ids.studentB, fullName: 'Bilal Badr', schoolId: ids.school, parentUserIds: [ids.parentB] });
  teachers.map.set(ids.teacher1, ids.teacherUser1);
  teachers.map.set(ids.teacher2, ids.teacherUser2);
  teachers.map.set(ids.teacher3, ids.teacherUser3);
  groups.map.set(ids.group1, { id: ids.group1, name: 'Fajr', schoolId: ids.school, teacherId: ids.teacher1 });
  groups.map.set(ids.group2, { id: ids.group2, name: 'Asr', schoolId: ids.school, teacherId: ids.teacher2 });
  groups.members.set(ids.group1, [ids.studentA, ids.studentA2, ids.studentB]);
  schools.managers.set(ids.org, [ids.manager1, ids.manager2]);

  return { h, deps, students, teachers, groups, schools, exams, sessions, assignments, quran, subscriptions, state, processor, deliver, redeliver, makeEvent, notificationsOf, allNotifications };
}
export type RulesHarness = ReturnType<typeof createRulesHarness>;
