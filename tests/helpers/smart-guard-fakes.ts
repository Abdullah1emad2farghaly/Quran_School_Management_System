import { AppError, FixedClock } from '../../src/modules/00-shared-kernel/public';
import type { LogFields, Logger } from '../../src/modules/05-logging-request-context/public';
import { SmartGuard } from '../../src/modules/25-smart-guard/public';

/** The official school centre used by the tests (the same one the Schools harness uses). */
export const SCHOOL_GPS = { latitude: 30.0444, longitude: 31.2357 };
/** One degree of latitude is about 111 195 m: +0.0004 is about 44.5 m (inside 50 m), +0.00046 is about 51.2 m (outside). */
export const INSIDE = { ...SCHOOL_GPS, latitude: SCHOOL_GPS.latitude + 0.0004, accuracyMeters: 10 };
export const OUTSIDE = { ...SCHOOL_GPS, latitude: SCHOOL_GPS.latitude + 0.00046, accuracyMeters: 10 };

export const START = new Date('2026-11-02T16:00:00.000Z');
export const END = new Date('2026-11-02T17:00:00.000Z');

export interface FakeSession {
  id: string;
  schoolId: string;
  groupId: string;
  teacherId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: string;
}

export const fakeSession = (over: Partial<FakeSession> = {}): FakeSession => ({ id: 'session-1', schoolId: 'school-1', groupId: 'group-1', teacherId: 'teacher-1', scheduledStart: START, scheduledEnd: END, status: 'IN_PROGRESS', ...over });

/** Records every log entry so tests can prove that no coordinate is ever logged. */
export function recordingLogger(): Logger & { entries: Array<{ level: string; message: string; fields?: LogFields }> } {
  const entries: Array<{ level: string; message: string; fields?: LogFields }> = [];
  const make = (level: string) => (message: string, fields?: LogFields) => void entries.push({ level, message, fields });
  const logger = { entries, error: make('error'), warn: make('warn'), info: make('info'), debug: make('debug'), child: () => logger } as unknown as Logger & { entries: typeof entries };
  return logger;
}

export function createGuardFakes(opts: { session?: FakeSession; school?: { status: string } | null } = {}) {
  const session = opts.session ?? fakeSession();
  const clock = new FixedClock(new Date('2026-11-02T16:30:00.000Z'));
  const logger = recordingLogger();
  const school = opts.school === null ? undefined : { id: 'school-1', ...SCHOOL_GPS, status: 'ACTIVE', ...(opts.school ?? {}) };
  const state = { session, school };
  const guard = new SmartGuard({
    sessions: { getSession: async (id: string) => { if (id !== state.session.id) throw new AppError('CLASS_SESSION_NOT_FOUND', 'NOT_FOUND'); return state.session as never; } },
    schools: { findById: async () => state.school as never },
    clock,
    logger,
  });
  return { guard, clock, logger, state };
}
