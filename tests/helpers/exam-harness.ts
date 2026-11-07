import { SmartGuard } from '../../src/modules/25-smart-guard/public';
import { ExamService, InMemoryExamRepository, registerExamAuthorization } from '../../src/modules/30-exams/public';
import { createClassSessionsHarness } from './class-sessions-harness';

/**
 * The Class Sessions harness (real Authorization Engine, real Modules 16-24, one movable clock `sessionClock`) plus the REAL Smart Guard and the REAL Exam service over an
 * in-memory repository. The exam permissions and the exam-scoped examiner resolver are registered exactly as the composition root registers them.
 */
export async function createExamHarness() {
  const t = await createClassSessionsHarness();
  const smartGuard = new SmartGuard({ sessions: t.classSessions, schools: t.service, clock: t.sessionClock });
  const examRepo = new InMemoryExamRepository();
  const exams = new ExamService({ exams: examRepo, smartGuard, teachers: t.teachers, groups: t.groups, parents: t.parents, unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: t.sessionClock });
  registerExamAuthorization({ policies: t.policies, resolvers: t.resolvers, exams: { findScopeById: (id) => exams.findScopeById(id) }, schools: t.service, teachers: t.teachers });
  return { ...t, smartGuard, examRepo, exams };
}
