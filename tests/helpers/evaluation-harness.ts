import { QuranRangeEngine } from '../../src/modules/22-quran-range-engine/public';
import { AttendanceService, InMemoryAttendanceRepository, registerAttendanceAuthorization } from '../../src/modules/26-attendance/public';
import { InMemoryMemorizationRepository, MemorizationService, registerMemorizationAuthorization } from '../../src/modules/27-memorization/public';
import { InMemoryRevisionRepository, RevisionRangeResolver, RevisionService, registerRevisionAuthorization } from '../../src/modules/28-revision/public';
import { EvaluationService, InMemoryEvaluationRepository, registerEvaluationAuthorization } from '../../src/modules/29-evaluations/public';
import { SmartGuard } from '../../src/modules/25-smart-guard/public';
import { createClassSessionsHarness } from './class-sessions-harness';
import { createMiniQuran } from './range-mini-quran';

/**
 * The Class Sessions harness (real Authorization Engine, Modules 16-24, one movable clock `sessionClock`) plus the REAL Smart Guard, the REAL Attendance, Memorization,
 * Revision and Evaluation services over in-memory repositories. Attendance gets the evaluation veto exactly as the composition root wires it (lazily, from Module 29).
 */
export async function createEvaluationHarness() {
  const t = await createClassSessionsHarness();
  const smartGuard = new SmartGuard({ sessions: t.classSessions, schools: t.service, clock: t.sessionClock });
  const evaluationRepo = new InMemoryEvaluationRepository();
  const holder: { evaluations?: EvaluationService } = {};
  const attendanceRepo = new InMemoryAttendanceRepository();
  const attendance = new AttendanceService({
    attendance: attendanceRepo, sessions: t.classSessions, smartGuard, teachers: t.teachers, groups: t.groups, schools: t.service, unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: t.sessionClock,
    evaluationGuard: { findEvaluatedStudents: (sessionId, studentIds, tx) => holder.evaluations!.findEvaluatedStudents(sessionId, studentIds, tx) },
  });
  const memorizationRepo = new InMemoryMemorizationRepository();
  const memorization = new MemorizationService({
    memorization: memorizationRepo, sessions: t.classSessions, smartGuard, teachers: t.teachers, groups: t.groups, schools: t.service,
    ranges: new QuranRangeEngine(createMiniQuran()), unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: t.sessionClock,
  });
  const revisionRepo = new InMemoryRevisionRepository();
  const revision = new RevisionService({
    revision: revisionRepo, sessions: t.classSessions, smartGuard, teachers: t.teachers, groups: t.groups, schools: t.service,
    ranges: new RevisionRangeResolver({ engine: new QuranRangeEngine(createMiniQuran()), quran: createMiniQuran() }), unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: t.sessionClock,
  });
  const evaluations = new EvaluationService({
    evaluations: evaluationRepo, sessions: t.classSessions, smartGuard, teachers: t.teachers, groups: t.groups, schools: t.service, attendance, memorization, revision,
    unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: t.sessionClock,
  });
  holder.evaluations = evaluations;
  registerAttendanceAuthorization({ policies: t.policies });
  registerMemorizationAuthorization({ policies: t.policies });
  registerRevisionAuthorization({ policies: t.policies });
  registerEvaluationAuthorization({ policies: t.policies });
  return { ...t, smartGuard, attendanceRepo, attendance, memorizationRepo, memorization, revisionRepo, revision, evaluationRepo, evaluations };
}
