import { FixedClock } from '../../src/modules/00-shared-kernel/public';
import { ClassSessionService, InMemoryClassSessionRepository, registerSessionAuthorization } from '../../src/modules/24-sessions/public';
import { createSchedulesHarness } from './schedules-harness';

/**
 * The Schedules harness (real sessions/auth, Authorization Engine, Parent / Teacher / Student services, Module 20 Groups and Module 23 Group Schedules) plus the
 * REAL Module 24 `ClassSessionService` over the in-memory session repository, with its own movable clock (`sessionClock`). The service reads Module 23's real
 * public service, so a slot added or retired through Module 23 is exactly what generation and reconciliation see.
 */
export async function createClassSessionsHarness() {
  const t = await createSchedulesHarness();
  const sessionClock = new FixedClock(new Date('2026-11-01T00:00:00Z'));
  const sessionRepo = new InMemoryClassSessionRepository();
  const classSessions = new ClassSessionService({ sessions: sessionRepo, schedule: t.schedules, teachers: t.teachers, unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: sessionClock });
  registerSessionAuthorization({ policies: t.policies });
  return { ...t, sessionClock, sessionRepo, classSessions };
}
