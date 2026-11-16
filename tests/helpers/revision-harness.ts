import { QuranRangeEngine } from '../../src/modules/22-quran-range-engine/public';
import { InMemoryRevisionRepository, RevisionRangeResolver, RevisionService, registerRevisionAuthorization } from '../../src/modules/28-revision/public';
import { registerQuranAuthorization } from '../../src/modules/21-quran-structure/public';
import { createAttendanceHarness } from './attendance-harness';
import { createQuranHarness } from './quran-service-harness';
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
  // Module 21 (the single Quran source) over the SYNTHETIC dataset, plus its existing read permission, for the `GET /revision/ayahs` selection endpoint.
  registerQuranAuthorization({ policies: t.policies });
  const quran = createQuranHarness();
  await quran.importSynthetic();
  return { ...t, revisionRepo, revision, quran };
}
