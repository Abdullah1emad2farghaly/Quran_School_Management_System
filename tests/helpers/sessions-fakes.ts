import { FixedClock, type DomainEvent, type TransactionContext, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import {
  ClassSessionService,
  InMemoryClassSessionRepository,
  createCancelSessionsOnSlotRetiredHandler,
} from '../../src/modules/24-sessions/public';
import type { ActiveSlotDto, ScheduleSlotDto } from '../../src/modules/23-group-schedules/public';

/** A group schedule slot as Module 23 holds it, for tests that do not need the whole Module 23. Monday 18:00-19:00 Cairo by default. */
export interface FakeSlot {
  id: string;
  groupId: string;
  schoolId: string;
  teacherId: string | null;
  dayOfWeek: ActiveSlotDto['dayOfWeek'];
  startTime: string;
  endTime: string;
  createdAt: Date;
  retiredAt: Date | null;
  retireReason: 'REPLACED' | 'REMOVED' | 'GROUP_ARCHIVED' | null;
}

export const NOW0 = new Date('2026-11-01T00:00:00Z');
export const TEACHER = { userId: 'user-teacher-1', teacherId: 'teacher-1' };
export const OTHER_TEACHER = { userId: 'user-teacher-2', teacherId: 'teacher-2' };

export function fakeSlot(over: Partial<FakeSlot> = {}): FakeSlot {
  return {
    id: 'slot-1', groupId: 'group-1', schoolId: 'school-1', teacherId: TEACHER.teacherId, dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00',
    createdAt: new Date('2026-10-10T10:00:00Z'), retiredAt: null, retireReason: null, ...over,
  };
}

/** Class session service over in-memory pieces. `clock.set(...)` moves time. Published events are collected in `events`. */
export function createSessionFakes(slots: FakeSlot[] = [fakeSlot()]) {
  const clock = new FixedClock(NOW0);
  const repo = new InMemoryClassSessionRepository();
  const events: DomainEvent[] = [];
  const unitOfWork: UnitOfWork = { run: (work) => work({} as TransactionContext) };
  const outbox = { publishFrom: async (aggregate: { pullDomainEvents(): DomainEvent[] }) => void events.push(...aggregate.pullDomainEvents()) };
  const schedule = {
    listActiveSlotsForSessions: async (): Promise<ActiveSlotDto[]> =>
      slots.filter((s) => s.retiredAt === null).map(({ id, groupId, schoolId, teacherId, dayOfWeek, startTime, endTime, createdAt }) => ({ id, groupId, schoolId, teacherId, dayOfWeek, startTime, endTime, createdAt })),
    findSlotsByIds: async (ids: readonly string[]): Promise<ScheduleSlotDto[]> =>
      slots.filter((s) => ids.includes(s.id)).map((s) => ({
        id: s.id, groupId: s.groupId, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, status: s.retiredAt ? 'RETIRED' : 'ACTIVE', createdAt: s.createdAt,
        createdBy: 'u', retiredAt: s.retiredAt, retiredBy: s.retiredAt ? 'u' : null, retireReason: s.retireReason, replacedBySlotId: null,
      }) as unknown as ScheduleSlotDto),
  };
  const teachers = { findByUserId: async (userId: string) => [TEACHER, OTHER_TEACHER].filter((t) => t.userId === userId).map((t) => ({ id: t.teacherId }))[0] };
  const service = new ClassSessionService({ sessions: repo, schedule: schedule as never, teachers: teachers as never, unitOfWork, outbox: outbox as never, clock });
  const retiredHandler = createCancelSessionsOnSlotRetiredHandler(() => service);
  const types = () => events.map((e) => e.eventType);
  const all = () => [...repo.rows.values()];
  return { clock, repo, events, service, slots, retiredHandler, types, all };
}
