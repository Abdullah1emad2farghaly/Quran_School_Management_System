import { FixedClock, type DomainEvent, type TransactionContext, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { ExamService, InMemoryExamRepository } from '../../src/modules/30-exams/public';

export const SCHOOL = 'school-1';
export const MANAGER = 'user-manager';
export const GPS = { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 };
export const at = (iso: string) => new Date(iso);
export const START = at('2026-12-01T09:00:00.000Z');
export const END = at('2026-12-01T11:00:00.000Z');
export const NOW = at('2026-11-20T08:00:00.000Z');

export interface FakeTeacher { id: string; userId: string; schoolIds: string[] }
export const teacher = (n: number, schoolIds: string[] = [SCHOOL]): FakeTeacher => ({ id: `teacher-${n}`, userId: `user-teacher-${n}`, schoolIds });

/**
 * ExamService over in-memory storage and small stand-ins for Modules 17, 18, 20 and 25 (Smart Guard's own rules are tested in Module 25): groups with their CURRENT students,
 * teachers registered in schools, parents. `clock.set(...)` moves time; `events` collects the published domain events; `smartGuardCalls` records every protected action.
 */
export function createExamFakes() {
  const clock = new FixedClock(NOW);
  const repo = new InMemoryExamRepository();
  const events: DomainEvent[] = [];
  const state = {
    groups: new Map<string, { id: string; name: string; schoolId: string; status: string; students: Array<{ studentId: string; fullName: string }> }>(),
    teachers: new Map<string, FakeTeacher>(),
    parentSchools: new Map<string, string[]>(),
    guardRejects: undefined as Error | undefined,
    smartGuardCalls: [] as Array<{ teacherId: string; schoolId: string; gps: unknown; window: { opensAt: Date; closesAt: Date | null } }>,
  };
  const addGroup = (id: string, students: string[], over: { schoolId?: string; status?: string; name?: string } = {}) => {
    state.groups.set(id, { id, name: over.name ?? `Group ${id}`, schoolId: over.schoolId ?? SCHOOL, status: over.status ?? 'ACTIVE', students: students.map((s) => ({ studentId: s, fullName: `Student ${s}` })) });
  };
  const addTeacher = (t: FakeTeacher) => void state.teachers.set(t.id, t);
  const unitOfWork: UnitOfWork = { run: (work) => work({} as TransactionContext) };
  const outbox = { publishFrom: async (aggregate: { pullDomainEvents(): DomainEvent[] }) => void events.push(...aggregate.pullDomainEvents()) };
  const service = new ExamService({
    exams: repo,
    smartGuard: { checkProtectedAction: async (input: { teacherId: string; schoolId: string; gps: unknown; window: { opensAt: Date; closesAt: Date | null } }) => { state.smartGuardCalls.push(input); if (state.guardRejects) throw state.guardRejects; } },
    teachers: {
      findById: async (id: string) => state.teachers.get(id) as never,
      findByUserId: async (userId: string) => [...state.teachers.values()].find((t) => t.userId === userId) as never,
    },
    groups: {
      listGroupsOfSchool: async (schoolId: string, input: { page: { page: number; pageSize: number } }) => {
        const all = [...state.groups.values()].filter((g) => g.schoolId === schoolId && g.status === 'ACTIVE');
        const { page, pageSize } = input.page;
        return { items: all.slice((page - 1) * pageSize, page * pageSize).map((g) => ({ id: g.id, name: g.name })), total: all.length, page, pageSize } as never;
      },
      listStudentsOfGroup: async (groupId: string, p: { page: number; pageSize: number }) => {
        const all = state.groups.get(groupId)?.students ?? [];
        return { items: all.slice((p.page - 1) * p.pageSize, p.page * p.pageSize), total: all.length, page: p.page, pageSize: p.pageSize } as never;
      },
      findScopeById: async (groupId: string) => state.groups.get(groupId) as never,
    },
    parents: {
      findByUserId: async (userId: string) => (state.parentSchools.has(userId) ? ({ id: `parent-of-${userId}` } as never) : undefined),
      listActiveSchoolIds: async (parentId: string) => state.parentSchools.get(parentId.replace('parent-of-', '')) ?? [],
    },
    unitOfWork,
    outbox: outbox as never,
    clock,
  });
  const types = () => events.map((e) => e.eventType);
  const config = (over: Record<string, unknown> = {}) => ({ schoolId: SCHOOL, startAt: START, endAt: END, questionCount: 3, maxScore: 10, groupIds: ['group-1'], examinerTeacherIds: ['teacher-1'], ...over });
  /** A SCHEDULED exam (default config) ready to start. */
  const scheduled = async (over: Record<string, unknown> = {}) => {
    const exam = await service.createExam(MANAGER, config(over) as never);
    await service.scheduleExam(exam.id, MANAGER);
    return exam.id;
  };
  /** A STARTED exam. */
  const started = async (over: Record<string, unknown> = {}) => {
    const id = await scheduled(over);
    clock.set(new Date(START.getTime() + 1000));
    await service.advanceExam(id);
    return id;
  };
  return { clock, repo, events, state, service, types, addGroup, addTeacher, config, scheduled, started };
}
