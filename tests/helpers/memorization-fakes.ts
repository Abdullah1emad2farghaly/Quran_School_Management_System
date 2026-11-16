import { AppError, FixedClock, type DomainEvent, type TransactionContext, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { InMemoryMemorizationRepository, MemorizationService } from '../../src/modules/27-memorization/public';

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

/** A range request over ayahs of one surah (the fake engine supports AYAHS only; the real engine is tested in Module 22). */
export const range = (surah: number, ayah: number, amount: number, direction: 'FORWARD' | 'BACKWARD' = 'FORWARD') => ({ start: { surah, ayah }, unit: 'AYAHS', amount, direction });

const fakeEngine = {
  calculate: async (req: { start?: { surah?: number; ayah?: number | null }; unit?: string; amount?: number; direction?: string }) => {
    const surah = req.start?.surah;
    const ayah = req.start?.ayah;
    if (typeof surah !== 'number' || typeof ayah !== 'number' || req.unit !== 'AYAHS' || typeof req.amount !== 'number' || req.amount < 1) throw new AppError('QURAN_RANGE_START_INVALID', 'VALIDATION');
    const firstAyah = req.direction === 'BACKWARD' ? ayah - req.amount + 1 : ayah;
    const lastAyah = req.direction === 'BACKWARD' ? ayah : ayah + req.amount - 1;
    if (firstAyah < 1 || lastAyah > 286) throw new AppError('QURAN_RANGE_EXCEEDS_QURAN', 'BUSINESS_RULE');
    const ref = (a: number) => ({ surah, ayah: a, globalPosition: a });
    return {
      request: { unit: req.unit, direction: req.direction, amount: req.amount, start: { surah, ayah } }, start: ref(ayah), end: ref(req.direction === 'BACKWARD' ? firstAyah : lastAyah),
      first: ref(firstAyah), last: ref(lastAyah), segments: [{ surah, firstAyah, lastAyah, ayahCount: req.amount, complete: false }],
      totals: { ayahs: req.amount, surahs: 1, pages: 1, textLines: req.amount },
    } as never;
  },
};

/** MemorizationService over in-memory pieces. Smart Guard is a recording fake (its own rules are tested in Module 25). `clock.set(...)` moves time. Events are collected. */
export function createMemorizationFakes(opts: { learningMode?: 'GROUP' | 'INDIVIDUAL' } = {}) {
  const clock = new FixedClock(at(2, 16));
  clock.set(new Date(Date.UTC(2026, 10, 2, 16, 30, 0)));
  const repo = new InMemoryMemorizationRepository();
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
  const service = new MemorizationService({
    memorization: repo,
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
    ranges: fakeEngine,
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
