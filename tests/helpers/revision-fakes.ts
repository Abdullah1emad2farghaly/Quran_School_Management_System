import { FixedClock, type DomainEvent, type TransactionContext, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { QuranRangeEngine } from '../../src/modules/22-quran-range-engine/public';
import { InMemoryRevisionRepository, RevisionRangeResolver, RevisionService } from '../../src/modules/28-revision/public';
import { createMiniQuran } from './range-mini-quran';

export const TEACHER = { userId: 'user-teacher-1', teacherId: 'teacher-1' };
export const OTHER_TEACHER = { userId: 'user-teacher-2', teacherId: 'teacher-2' };
export const MANAGER = 'user-manager-1';
export const OTHER_USER = 'user-other';
export const STUDENTS = ['student-1', 'student-2', 'student-3'];
export const GPS = { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 };

/** Sessions of group-1, one per week (16:00-17:00 UTC). */
export const S1 = 'session-1';
export const S2 = 'session-2';
export const S3 = 'session-3';
const at = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour, 0, 0));
export interface FakeSession {
  id: string; schoolId: string; groupId: string; teacherId: string; status: string; occurrenceDate: string; scheduledStart: Date; scheduledEnd: Date;
}
const session = (id: string, day: number, status: string): FakeSession => ({
  id, schoolId: 'school-1', groupId: 'group-1', teacherId: TEACHER.teacherId, status, occurrenceDate: `2026-11-${String(day).padStart(2, '0')}`, scheduledStart: at(day, 16), scheduledEnd: at(day, 17),
});

/** A revision range entered as Start + Unit + Amount in AYAHS (the surah is required): `range(2, 1, 5)` = five ayahs from 2:1. The real resolver and engine run over the mini Quran (15 ayahs). */
export const range = (surah: number, ayah: number, amount: number, direction: 'FORWARD' | 'BACKWARD' = 'FORWARD') => ({ unit: 'AYAHS', surah, start: ayah, amount, direction });

/** RevisionService over in-memory pieces. Smart Guard is a recording fake (its own rules are tested in Module 25). `clock.set(...)` moves time. Events are collected. */
export function createRevisionFakes(opts: { learningMode?: 'GROUP' | 'INDIVIDUAL' } = {}) {
  const clock = new FixedClock(at(2, 16));
  clock.set(new Date(Date.UTC(2026, 10, 2, 16, 30, 0)));
  const repo = new InMemoryRevisionRepository();
  const events: DomainEvent[] = [];
  const sessions = new Map<string, FakeSession>([[S1, session(S1, 2, 'IN_PROGRESS')], [S2, session(S2, 9, 'OPEN')], [S3, session(S3, 16, 'OPEN')]]);
  const state = { learningMode: opts.learningMode ?? 'GROUP', guardRejects: undefined as Error | undefined, guardCalls: [] as Array<{ teacherId: string; sessionId: string; gps: unknown }> };
  const assigned = new Map<string, string[]>(STUDENTS.map((s) => [s, ['group-1']]));
  const managers = new Set([`${MANAGER}:school-1`]);
  const unitOfWork: UnitOfWork = { run: (work) => work({} as TransactionContext) };
  const outbox = { publishFrom: async (aggregate: { pullDomainEvents(): DomainEvent[] }) => void events.push(...aggregate.pullDomainEvents()) };
  const getSession = async (id: string) => {
    const found = sessions.get(id);
    if (!found) throw Object.assign(new Error('CLASS_SESSION_NOT_FOUND'), { code: 'CLASS_SESSION_NOT_FOUND' });
    return found as never;
  };
  const service = new RevisionService({
    revision: repo,
    sessions: { getSession, findGroupIdOf: async (id: string) => ((await getSession(id)) as FakeSession).groupId },
    smartGuard: {
      check: async (input: { teacherId: string; sessionId: string; gps: unknown }) => {
        state.guardCalls.push(input);
        if (state.guardRejects) throw state.guardRejects;
        return {} as never;
      },
    },
    teachers: { findByUserId: async (userId: string) => [TEACHER, OTHER_TEACHER].filter((t) => t.userId === userId).map((t) => ({ id: t.teacherId }))[0] as never },
    groups: {
      getGroup: async () => ({ id: 'group-1', learningMode: state.learningMode }) as never,
      listAssignmentHistoryOfStudent: async (studentId: string) => (assigned.get(studentId) ?? []).map((groupId) => ({ groupId, unassignedAt: null })) as never,
    },
    schools: { isSchoolManager: async (userId: string, schoolId: string) => managers.has(`${userId}:${schoolId}`) },
    ranges: new RevisionRangeResolver({ engine: new QuranRangeEngine(createMiniQuran()), quran: createMiniQuran() }),
    unitOfWork,
    outbox: outbox as never,
    clock,
  });
  const setStatus = (id: string, status: string) => void (sessions.get(id)!.status = status);
  const reschedule = (id: string, day: number) => { const s = sessions.get(id)!; s.scheduledStart = at(day, 18); s.scheduledEnd = at(day, 19); };
  /** The first session ends; the second one is the next actual session and is now in progress. */
  const endFirstSession = () => { setStatus(S1, 'COMPLETED'); clock.set(new Date(Date.UTC(2026, 10, 2, 17, 5, 0))); };
  const startSecond = () => { setStatus(S2, 'IN_PROGRESS'); clock.set(new Date(Date.UTC(2026, 10, 9, 16, 30, 0))); };
  const endSecond = () => { setStatus(S2, 'COMPLETED'); clock.set(new Date(Date.UTC(2026, 10, 9, 17, 5, 0))); };
  const startThird = () => { setStatus(S3, 'IN_PROGRESS'); clock.set(new Date(Date.UTC(2026, 10, 16, 16, 30, 0))); };
  const types = () => events.map((e) => e.eventType);
  return { clock, repo, events, sessions, state, assigned, service, types, setStatus, reschedule, endFirstSession, startSecond, endSecond, startThird };
}
