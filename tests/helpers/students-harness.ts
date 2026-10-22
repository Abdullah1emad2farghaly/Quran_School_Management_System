import {
  InMemoryStudentRepository,
  StudentService,
  registerStudentAuthorization,
  type StudentGroupAccess,
} from '../../src/modules/19-students/public';
import type { RollbackStore } from './schools-api-harness';
import { createTeachersHarness } from './teachers-harness';

export const PARENT_NAME = 'أحمد محمد علي';
export const STUDENT_NAME = 'عمر أحمد محمد';
export const NATIONAL_ID = '30001010123456';

/**
 * In-memory wiring of Modules 08-10, 12, 13-18 (the Teachers harness: real sessions, real Authorization Engine, real Parent and Teacher
 * services) plus Module 19. Its unit of work rolls the Student store back together with everything else when the work throws. The real
 * Students guard replaces the stand-in unlink guard of the Parents harness. Group assignments (Module 20) are simulated by `assignToGroup`.
 */
export async function createStudentsHarness(options: { extraStores?: readonly RollbackStore[] } = {}) {
  const studentRepo = new InMemoryStudentRepository();
  const t = await createTeachersHarness({ extraStores: [studentRepo, ...(options.extraStores ?? [])] });

  /** `${teacherId}:${studentId}` pairs standing for "the student is in a group of this teacher" (what Module 20 will answer). */
  const groupPairs = new Set<string>();
  /** The real Groups access (Module 20), once a Groups harness installs it with `useGroupAccess`; until then `groupPairs` answers. */
  let realGroupAccess: StudentGroupAccess | undefined;
  const groupAccess: StudentGroupAccess = {
    isStudentInGroupOfTeacher: async (studentId, teacherId) => (realGroupAccess ? realGroupAccess.isStudentInGroupOfTeacher(studentId, teacherId) : groupPairs.has(`${teacherId}:${studentId}`)),
  };

  const students = new StudentService({
    students: studentRepo,
    schools: t.service,
    parents: t.parents,
    unitOfWork: t.unitOfWork,
    outbox: t.h.outbox,
    clock: t.h.clock,
  });
  t.useStudentGuard(students);
  registerStudentAuthorization({ policies: t.policies, resolvers: t.resolvers, students, schools: t.service, parents: t.parents, teachers: t.teachers, groupAccess });

  let phone = 1000;
  /** A Parent (three-part name) registered by `manager` for `schoolId`. */
  const newParent = async (schoolId: string, managerId: string, name = PARENT_NAME) => {
    phone += 1;
    const result = await t.parents.registerParent({ schoolId, name, phone: `0101000${phone}`, address: { kind: 'raw', text: 'المنيا / سمالوط / برمشا' } }, managerId);
    return result.parent;
  };
  let idCounter = 0;
  /** A fresh, valid 14-digit National ID per call. */
  const nextNationalId = () => String(30001010000000 + ++idCounter);
  const registerStudent = (schoolId: string, parentId: string, managerId: string, over: Record<string, unknown> = {}) =>
    students.registerStudent({ schoolId, parentId, fullName: STUDENT_NAME, nationalId: nextNationalId(), ...over } as never, managerId);
  const assignToGroup = (teacherId: string, studentId: string) => groupPairs.add(`${teacherId}:${studentId}`);

  const useGroupAccess = (access: StudentGroupAccess): void => {
    realGroupAccess = access;
  };

  return { ...t, studentRepo, students, groupPairs, newParent, nextNationalId, registerStudent, assignToGroup, useGroupAccess };
}
