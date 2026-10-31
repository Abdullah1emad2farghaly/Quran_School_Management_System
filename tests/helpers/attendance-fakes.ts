import { FixedClock, type DomainEvent, type TransactionContext, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { AttendanceService, InMemoryAttendanceRepository } from '../../src/modules/26-attendance/public';

export const START = new Date('2026-11-02T16:00:00.000Z');
export const END = new Date('2026-11-02T17:00:00.000Z');
export const TEACHER = { userId: 'user-teacher-1', teacherId: 'teacher-1' };
export const OTHER_TEACHER = { userId: 'user-teacher-2', teacherId: 'teacher-2' };
export const MANAGER = 'user-manager-1';
export const OTHER_USER = 'user-other';
export const STUDENTS = ['student-1', 'student-2', 'student-3'];
export const GPS = { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 };

export interface FakeSessionDto {
  id: string; schoolId: string; groupId: string; teacherId: string; status: string; occurrenceDate: string; scheduledStart: Date; scheduledEnd: Date;
}
export const fakeSession = (over: Partial<FakeSessionDto> = {}): FakeSessionDto => ({
  id: 'session-1', schoolId: 'school-1', groupId: 'group-1', teacherId: TEACHER.teacherId, status: 'IN_PROGRESS', occurrenceDate: '2026-11-02', scheduledStart: START, scheduledEnd: END, ...over,
});

/** AttendanceService over in-memory pieces. Smart Guard is a recording fake (its own rules are tested in Module 25). `clock.set(...)` moves time. Events are collected in `events`. */
export function createAttendanceFakes(opts: { session?: FakeSessionDto } = {}) {
  const clock = new FixedClock(new Date('2026-11-02T16:30:00.000Z'));
  const repo = new InMemoryAttendanceRepository();
  const events: DomainEvent[] = [];
  const state = { session: opts.session ?? fakeSession(), guardRejects: undefined as Error | undefined, guardCalls: [] as Array<{ teacherId: string; sessionId: string; gps: unknown }> };
  /** studentId -> groups the student is CURRENTLY assigned to. */
  const assigned = new Map<string, string[]>(STUDENTS.map((s) => [s, ['group-1']]));
  const managers = new Set([`${MANAGER}:school-1`]);
  const unitOfWork: UnitOfWork = { run: (work) => work({} as TransactionContext) };
  const outbox = { publishFrom: async (aggregate: { pullDomainEvents(): DomainEvent[] }) => void events.push(...aggregate.pullDomainEvents()) };
  const service = new AttendanceService({
    attendance: repo,
    sessions: {
      getSession: async (id: string) => { if (id !== state.session.id) throw Object.assign(new Error('CLASS_SESSION_NOT_FOUND'), { code: 'CLASS_SESSION_NOT_FOUND' }); return state.session as never; },
      findGroupIdOf: async () => state.session.groupId,
    },
    smartGuard: { check: async (input: { teacherId: string; sessionId: string; gps: unknown }) => { state.guardCalls.push(input); if (state.guardRejects) throw state.guardRejects; return { sessionId: input.sessionId, schoolId: 'school-1', groupId: 'group-1', teacherId: input.teacherId }; } },
    teachers: { findByUserId: async (userId: string) => [TEACHER, OTHER_TEACHER].filter((t) => t.userId === userId).map((t) => ({ id: t.teacherId }))[0] as never },
    groups: { listAssignmentHistoryOfStudent: async (studentId: string) => (assigned.get(studentId) ?? []).map((groupId) => ({ groupId, unassignedAt: null })) as never },
    schools: { isSchoolManager: async (userId: string, schoolId: string) => managers.has(`${userId}:${schoolId}`) },
    unitOfWork,
    outbox: outbox as never,
    clock,
  });
  const types = () => events.map((e) => e.eventType);
  return { clock, repo, events, state, assigned, service, types };
}
