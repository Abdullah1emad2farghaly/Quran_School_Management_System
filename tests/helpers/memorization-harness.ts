import { QuranRangeEngine } from '../../src/modules/22-quran-range-engine/public';
import { InMemoryMemorizationRepository, MemorizationService, registerMemorizationAuthorization } from '../../src/modules/27-memorization/public';
import { createAttendanceHarness } from './attendance-harness';
import { createMiniQuran } from './range-mini-quran';

/**
 * The Attendance harness (real Authorization Engine, Modules 16-25 including the REAL Smart Guard, one movable clock `sessionClock`) plus the REAL Module 27
 * `MemorizationService` over the in-memory memorization repository and the REAL Quran Range Engine over the hand-built mini Quran (surah 2 has 6 ayahs, surah 3 has 4).
 */
export async function createMemorizationHarness() {
  const t = await createAttendanceHarness();
  const memorizationRepo = new InMemoryMemorizationRepository();
  const memorization = new MemorizationService({
    memorization: memorizationRepo, sessions: t.classSessions, smartGuard: t.smartGuard, teachers: t.teachers, groups: t.groups, schools: t.service,
    ranges: new QuranRangeEngine(createMiniQuran()), unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: t.sessionClock,
  });
  registerMemorizationAuthorization({ policies: t.policies });
  return { ...t, memorizationRepo, memorization };
}
