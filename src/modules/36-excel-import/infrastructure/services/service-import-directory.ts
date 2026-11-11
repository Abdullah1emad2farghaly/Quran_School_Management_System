import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { UnifiedAddressLookup } from '../../../15-unified-address/public';
import type { IdentityService } from '../../../08-identity-core/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { ParentLookup } from '../../../17-parents/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import type { StudentNationalIdLookup } from '../../../19-students/public';
import type { GroupNameLookup } from '../../../20-groups/public';
import type { GroupScheduleService } from '../../../23-group-schedules/public';
import type { ImportDirectory } from '../../application/ports/import-directory';

export interface ServiceImportDirectoryDeps {
  readonly schools: Pick<SchoolLookup, 'findById'>;
  readonly identity: Pick<IdentityService, 'findByPhone'>;
  readonly parents: Pick<ParentLookup, 'findByUserId' | 'isLinkedToSchool'>;
  readonly teachers: Pick<TeacherLookup, 'findByUserId' | 'isLinkedToSchool'>;
  readonly students: StudentNationalIdLookup;
  readonly groups: GroupNameLookup;
  readonly schedules: Pick<GroupScheduleService, 'listSlots' | 'listOwnSchedule'>;
  readonly address: Pick<UnifiedAddressLookup, 'validateRawParentAddress'>;
}

/** The importer's read-only directory, built ONLY from the public contracts of the modules that own the data. */
export function createServiceImportDirectory(deps: ServiceImportDirectoryDeps): ImportDirectory {
  return {
    findSchool: async (schoolId, tx) => {
      const school = await deps.schools.findById(schoolId, tx);
      return school ? { id: school.id, organizationId: school.organizationId, status: school.status } : undefined;
    },
    findUserByPhone: async (phone, tx) => {
      const user = await deps.identity.findByPhone(phone, tx);
      return user ? { id: user.id, fullName: user.fullName, isActive: user.isActive } : undefined;
    },
    findParentByUserId: async (userId, tx) => {
      const parent = await deps.parents.findByUserId(userId, tx);
      return parent ? { id: parent.id, organizationId: parent.organizationId } : undefined;
    },
    isParentLinked: (parentId, schoolId, tx) => deps.parents.isLinkedToSchool(parentId, schoolId, tx),
    findTeacherByUserId: async (userId, tx) => {
      const teacher = await deps.teachers.findByUserId(userId, tx);
      return teacher ? { id: teacher.id, organizationId: teacher.organizationId } : undefined;
    },
    isTeacherLinked: (teacherId, schoolId, tx) => deps.teachers.isLinkedToSchool(teacherId, schoolId, tx),
    findStudentByNationalId: async (nationalId, tx) => {
      const student = await deps.students.findByNationalId(nationalId, tx);
      return student ? { id: student.id, schoolId: student.schoolId, parentId: student.parentId, status: student.status } : undefined;
    },
    currentGroupOfStudent: async (studentId, tx) => {
      const current = (await deps.groups.listAssignmentHistoryOfStudent(studentId, tx)).find((a) => a.unassignedAt === null);
      return current ? { id: current.groupId, name: current.groupName } : undefined;
    },
    findActiveGroupByName: async (schoolId, name, tx) => {
      const group = await deps.groups.findActiveByName(schoolId, name, tx);
      return group ? { id: group.id, teacherId: group.teacher?.id ?? null, learningMode: group.learningMode, progression: group.progression, startingSurah: group.startingSurah } : undefined;
    },
    listSlotsOfGroup: async (groupId, tx) => (await deps.schedules.listSlots(groupId, tx)).filter((s) => s.status === 'ACTIVE').map((s) => ({ day: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime })),
    listSlotsOfTeacher: async (teacherUserId, tx) =>
      (await deps.schedules.listOwnSchedule(teacherUserId, tx)).map((s) => ({ day: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, groupId: s.groupId, groupName: s.groupName })),
    validateParentAddress: async (rawAddress: string, organizationId: string, tx?: TransactionContext) => {
      await deps.address.validateRawParentAddress(rawAddress, organizationId, tx);
    },
  };
}
