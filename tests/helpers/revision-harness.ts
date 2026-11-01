import { QuranRangeEngine } from '../../src/modules/22-quran-range-engine/public';
import { InMemoryRevisionRepository, RevisionRangeResolver, RevisionService, registerRevisionAuthorization } from '../../src/modules/28-revision/public';
import { createAttendanceHarness } from './attendance-harness';
import { createMiniQuran } from './range-mini-quran';

/**
 * The Attendance harness (real Authorization Engine, Modules 16-25 including the REAL Smart Guard, one movable clock `sessionClock`) plus the REAL Module 28
 * `RevisionService` over the in-memory revision repository and the REAL Quran Range Engine over the hand-built mini Quran (surah 2 has 6 ayahs, surah 3 has 4).
 */
export async function createRevisionHarness() {
  const t = await createAttendanceHarness();
  const revisionRepo = new InMemoryRevisionRepository();
  const revision = new RevisionService({
    revision: revisionRepo, sessions: t.classSessions, smartGuard: t.smartGuard, teachers: t.teachers, groups: t.groups, schools: t.service,
    ranges: new RevisionRangeResolver({ engine: new QuranRangeEngine(createMiniQuran()), quran: createMiniQuran() }), unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: t.sessionClock,
  });
  registerRevisionAuthorization({ policies: t.policies });
  return { ...t, revisionRepo, revision };
}
