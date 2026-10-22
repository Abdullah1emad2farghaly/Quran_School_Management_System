import { GroupService, InMemoryGroupRepository, createStudentArchivedHandler, registerGroupAuthorization } from '../../src/modules/20-groups/public';
import { STUDENT_NAME, createStudentsHarness } from './students-harness';

export const GROUP_NAME = 'حلقة الفجر';
export const TEACHER_NAME = 'خالد أحمد حسن';

/**
 * In-memory wiring of Modules 08-10, 12, 13-19 (the Students harness: real sessions, real Authorization Engine, real Parent / Teacher / Student
 * services) plus Module 20. Its unit of work rolls the Group store back together with everything else when the work throws. The REAL Groups
 * guard replaces the stand-in unlink guard of Module 18, and the REAL Groups access replaces the Teacher read stand-in of Module 19.
 */
export async function createGroupsHarness() {
  const groupRepo = new InMemoryGroupRepository();
  const t = await createStudentsHarness({ extraStores: [groupRepo] });

  const groups = new GroupService({ groups: groupRepo, schools: t.service, teachers: t.teachers, students: t.students, unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: t.h.clock });
  t.useGroupGuard(groups);
  t.useGroupAccess(groups);
  registerGroupAuthorization({ policies: t.policies, resolvers: t.resolvers, groups, schools: t.service, parents: t.parents, teachers: t.teachers });
  const archivedHandler = createStudentArchivedHandler(() => groups);

  let phone = 5000;
  /** A Teacher (three-part name) registered by `managerId` for `schoolId`. */
  const newTeacher = async (schoolId: string, managerId: string, name = TEACHER_NAME) => {
    phone += 1;
    return (await t.teachers.registerTeacher({ schoolId, name, phone: `0100555${phone}` }, managerId)).teacher;
  };
  let groupCounter = 0;
  const newGroup = (schoolId: string, managerId: string, over: Record<string, unknown> = {}) =>
    groups.createGroup({ schoolId, name: `${GROUP_NAME} ${++groupCounter}`, learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, ...over } as never, managerId);
  /** Delivers a `StudentStatusChanged` event the way the outbox processor would. */
  const deliverStudentEvents = async () => {
    for (const m of t.h.store.messages.filter((x) => x.eventType === 'StudentStatusChanged')) {
      await archivedHandler.handle({ eventType: m.eventType, payload: JSON.parse(m.payload) } as never);
    }
  };
  return { ...t, groupRepo, groups, archivedHandler, newTeacher, newGroup, deliverStudentEvents, STUDENT_NAME };
}
