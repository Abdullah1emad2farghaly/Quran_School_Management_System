import { GroupService, InMemoryGroupRepository, createStudentArchivedHandler, registerGroupAuthorization } from '../../src/modules/20-groups/public';
import { GroupScheduleService, InMemoryScheduleRepository, registerScheduleAuthorization } from '../../src/modules/23-group-schedules/public';
import { GROUP_NAME, TEACHER_NAME } from './groups-harness';
import { createStudentsHarness } from './students-harness';

/**
 * In-memory wiring of Modules 08-10, 12, 13-19 (real sessions, real Authorization Engine, real Parent / Teacher / Student services), the REAL Module 20
 * (Groups) and Module 23 (Group Schedules), connected the way the application connects them: Module 20 calls Module 23 through its schedule port
 * (a Teacher change is validated, an archive retires the slots) and Module 23 reads Module 20 through its public service. The unit of work rolls the
 * Group store and the Schedule store back together with everything else when the work throws.
 */
export async function createSchedulesHarness() {
  const groupRepo = new InMemoryGroupRepository();
  const slotRepo = new InMemoryScheduleRepository();
  const t = await createStudentsHarness({ extraStores: [groupRepo, slotRepo] });

  let schedules: GroupScheduleService | undefined;
  const lazy = () => {
    if (!schedules) throw new Error('schedules not wired yet');
    return schedules;
  };
  const groups = new GroupService({
    groups: groupRepo,
    schools: t.service,
    teachers: t.teachers,
    students: t.students,
    unitOfWork: t.unitOfWork,
    outbox: t.h.outbox,
    clock: t.h.clock,
    schedule: {
      assertTeacherCanTeach: (group, teacherId, tx) => lazy().assertTeacherCanTeach(group, teacherId, tx),
      onTeacherChanged: (groupId, teacherId, tx) => lazy().onTeacherChanged(groupId, teacherId, tx),
      retireSlotsOfArchivedGroup: (groupId, actorId, tx) => lazy().retireSlotsOfArchivedGroup(groupId, actorId, tx),
    },
  });
  t.useGroupGuard(groups);
  t.useGroupAccess(groups);
  registerGroupAuthorization({ policies: t.policies, resolvers: t.resolvers, groups, schools: t.service, parents: t.parents, teachers: t.teachers });
  const archivedHandler = createStudentArchivedHandler(() => groups);

  schedules = new GroupScheduleService({ slots: slotRepo, groups, teachers: t.teachers, unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: t.h.clock });
  registerScheduleAuthorization({ policies: t.policies });

  let phone = 7000;
  const identities = new Map<string, { phone: string; name: string }>();
  /** A Teacher registered by `managerId` for `schoolId`. */
  const newTeacher = async (schoolId: string, managerId: string, name = TEACHER_NAME) => {
    phone += 1;
    const number = `0100777${phone}`;
    const teacher = (await t.teachers.registerTeacher({ schoolId, name, phone: number }, managerId)).teacher;
    identities.set(teacher.id, { phone: number, name });
    return teacher;
  };
  let groupCounter = 0;
  const newGroup = (schoolId: string, managerId: string, over: Record<string, unknown> = {}) =>
    groups.createGroup({ schoolId, name: `${GROUP_NAME} ${++groupCounter}`, learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, ...over } as never, managerId);
  /** Links an existing Teacher to another school of the same organization (a Teacher may belong to several): the same registration with the same phone and name. */
  const linkTeacher = async (teacherId: string, schoolId: string, managerId: string) => {
    const identity = identities.get(teacherId)!;
    await t.teachers.registerTeacher({ schoolId, name: identity.name, phone: identity.phone }, managerId);
  };
  return { ...t, groupRepo, slotRepo, groups, schedules: lazy(), archivedHandler, newTeacher, newGroup, linkTeacher };
}
