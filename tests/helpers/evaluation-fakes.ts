import { FixedClock, type DomainEvent, type TransactionContext, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { EvaluationService, InMemoryEvaluationRepository } from '../../src/modules/29-evaluations/public';

export const START = new Date('2026-11-02T16:00:00.000Z');
export const END = new Date('2026-11-02T17:00:00.000Z');
export const TEACHER = { userId: 'user-teacher-1', teacherId: 'teacher-1' };
export const OTHER_USER = 'user-other';
export const MANAGER = 'user-manager-1';
export const STUDENTS = ['student-1', 'student-2', 'student-3'];
export const GPS = { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 };
export const at = (iso: string) => new Date(iso);

export interface FakeSessionDto {
  id: string; schoolId: string; groupId: string; teacherId: string; status: string; occurrenceDate: string; scheduledStart: Date; scheduledEnd: Date;
}
export const fakeSession = (over: Partial<FakeSessionDto> = {}): FakeSessionDto => ({
  id: 'session-1', schoolId: 'school-1', groupId: 'group-1', teacherId: TEACHER.teacherId, status: 'IN_PROGRESS', occurrenceDate: '2026-11-02', scheduledStart: START, scheduledEnd: END, ...over,
});

type Assignment = { id: string; studentId: string | null };

/**
 * EvaluationService over in-memory pieces. Smart Guard is a recording fake (its own rules, including the grace exception, are tested in Module 25). `clock.set(...)` moves time.
 * Attendance statuses, the scheduled assignments, the roster and the session are plain state the test changes. Events are collected in `events`.
 */
export function createEvaluationFakes(opts: { session?: FakeSessionDto } = {}) {
  const clock = new FixedClock(new Date('2026-11-02T16:30:00.000Z'));
  const repo = new InMemoryEvaluationRepository();
  const events: DomainEvent[] = [];
  const state = {
    session: opts.session ?? fakeSession(),
    guardRejects: undefined as Error | undefined,
    guardCalls: [] as Array<{ teacherId: string; sessionId: string; gps: unknown; allowAfterEndMinutes?: number }>,
    lockedSessions: [] as string[],
    /** studentId -> PRESENT / ABSENT. A student that is not here is UNMARKED. */
    attendance: new Map<string, 'PRESENT' | 'ABSENT'>(),
    memorization: [{ id: 'mem-group', studentId: null }] as Assignment[],
    revision: [] as Assignment[],
    /** Is called inside the unit of work, right after the session lock (to simulate a concurrent change). */
    onLocked: undefined as (() => void) | undefined,
  };
  const assigned = new Map<string, string[]>(STUDENTS.map((s) => [s, ['group-1']]));
  const managers = new Set([`${MANAGER}:school-1`]);
  const unitOfWork: UnitOfWork = { run: (work) => work({} as TransactionContext) };
  const outbox = { publishFrom: async (aggregate: { pullDomainEvents(): DomainEvent[] }) => void events.push(...aggregate.pullDomainEvents()) };
  const getSession = async (id: string) => {
    if (id !== state.session.id) throw Object.assign(new Error('CLASS_SESSION_NOT_FOUND'), { code: 'CLASS_SESSION_NOT_FOUND' });
    return state.session as never;
  };
  const service = new EvaluationService({
    evaluations: repo,
    sessions: {
      getSession,
      findGroupIdOf: async () => state.session.groupId,
      lockSession: async (id: string) => { state.lockedSessions.push(id); state.onLocked?.(); return getSession(id); },
    },
    smartGuard: { check: async (input: { teacherId: string; sessionId: string; gps: unknown; allowAfterEndMinutes?: number }) => { state.guardCalls.push(input); if (state.guardRejects) throw state.guardRejects; return { sessionId: input.sessionId, schoolId: 'school-1', groupId: 'group-1', teacherId: input.teacherId }; } },
    teachers: { findByUserId: async (userId: string) => (userId === TEACHER.userId ? { id: TEACHER.teacherId } : undefined) as never },
    groups: {
      listAssignmentHistoryOfStudent: async (studentId: string) => (assigned.get(studentId) ?? []).map((groupId) => ({ groupId, unassignedAt: null })) as never,
      listStudentsOfGroup: async (_groupId: string, page: { page: number; pageSize: number }) => {
        const ids = [...assigned.entries()].filter(([, groups]) => groups.includes('group-1')).map(([id]) => id);
        return { items: ids.slice((page.page - 1) * page.pageSize, page.page * page.pageSize).map((studentId) => ({ studentId })), total: ids.length, page: page.page, pageSize: page.pageSize } as never;
      },
    },
    schools: { isSchoolManager: async (userId: string, schoolId: string) => managers.has(`${userId}:${schoolId}`) },
    attendance: {
      lockStudentStatuses: async (_s: string, ids: readonly string[]) => new Map(ids.filter((id) => state.attendance.has(id)).map((id) => [id, state.attendance.get(id)!])) as never,
      listStudentStatuses: async () => new Map(state.attendance) as never,
    },
    memorization: { getScheduledMemorization: async () => ({ assignments: state.memorization }) as never },
    revision: { getScheduledRevision: async () => ({ assignments: state.revision }) as never },
    unitOfWork,
    outbox: outbox as never,
    clock,
  });
  const types = () => events.map((e) => e.eventType);
  return { clock, repo, events, state, assigned, service, types };
}
