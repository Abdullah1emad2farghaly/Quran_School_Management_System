import {
  InMemoryTeacherRepository,
  InMemoryTeacherSchoolLinkRepository,
  TeacherService,
  registerTeacherAuthorization,
} from '../../src/modules/18-teachers/public';
import type { TeacherGroupDependencies } from '../../src/modules/18-teachers/public';
import { createParentsHarness } from './parents-harness';
import type { RollbackStore } from './schools-api-harness';

/**
 * In-memory wiring of Modules 08-10, 12, 13-17 (the Parents harness: real sessions, real Authorization Engine, real Parent service) plus
 * Module 18. Its unit of work rolls the Teacher stores back together with everything else when the work throws.
 * Existing accounts are matched by the canonical name stored on the account (`users.full_name`), exactly as in production.
 */
export async function createTeachersHarness(options: { extraStores?: readonly RollbackStore[] } = {}) {
  const teacherRepo = new InMemoryTeacherRepository();
  const links = new InMemoryTeacherSchoolLinkRepository();
  teacherRepo.activeTeacherIdsOfSchool = (schoolId) => links.activeTeacherIdsOfSchool(schoolId);
  const t = await createParentsHarness({ extraStores: [teacherRepo, links, ...(options.extraStores ?? [])] });

  /** Groups depending on a Teacher-to-School link, by `${teacherId}:${schoolId}` (what Module 20 will report). */
  const groupCounts = new Map<string, number>();
  /** The real Groups guard (Module 20), once a Groups harness installs it with `useGroupGuard`; until then `groupCounts` answers. */
  let groupGuard: TeacherGroupDependencies | undefined;
  const teachers = new TeacherService({
    teachers: teacherRepo,
    links,
    schools: t.service,
    identity: t.h.identity,
    roles: t.h.roles,
    parents: t.parents,
    groupDependencies: {
      countGroupsOfTeacherInSchool: async (teacherId, schoolId, tx) => (groupGuard ? groupGuard.countGroupsOfTeacherInSchool(teacherId, schoolId, tx) : (groupCounts.get(`${teacherId}:${schoolId}`) ?? 0)),
    },
    unitOfWork: t.unitOfWork,
    outbox: t.h.outbox,
    clock: t.h.clock,
  });
  registerTeacherAuthorization({ policies: t.policies, resolvers: t.resolvers, teachers, schools: t.service });
  const useGroupGuard = (guard: TeacherGroupDependencies): void => {
    groupGuard = guard;
  };
  return { ...t, teacherRepo, teacherLinks: links, teachers, groupCounts, useGroupGuard };
}
