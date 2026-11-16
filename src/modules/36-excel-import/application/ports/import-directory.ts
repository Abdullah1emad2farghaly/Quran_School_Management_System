import type { TransactionContext } from '../../../00-shared-kernel/public';

export interface DirectoryUser {
  readonly id: string;
  readonly fullName: string | null;
  readonly isActive: boolean;
}
export interface DirectoryPerson {
  readonly id: string;
  readonly organizationId: string;
}
export interface DirectoryStudent {
  readonly id: string;
  readonly schoolId: string;
  readonly parentId: string;
  readonly status: string;
}
export interface DirectoryGroup {
  readonly id: string;
  readonly teacherId: string | null;
  readonly learningMode: string;
  readonly progression: string;
  readonly startingSurah: number;
}
export interface DirectorySlot {
  readonly day: string;
  readonly startTime: string;
  readonly endTime: string;
}
export interface DirectoryTeacherSlot extends DirectorySlot {
  readonly groupId: string;
  readonly groupName: string;
}

/**
 * Read-only view of the other modules' data that the importer needs to classify rows (create / reuse / conflict). Implemented over the PUBLIC
 * contracts of Modules 08, 15-20 and 23 (see `createServiceImportDirectory`); it never reads another module's tables or repositories.
 */
export interface ImportDirectory {
  findSchool(schoolId: string, tx?: TransactionContext): Promise<{ id: string; organizationId: string; status: string } | undefined>;
  findUserByPhone(phone: string, tx?: TransactionContext): Promise<DirectoryUser | undefined>;
  findParentByUserId(userId: string, tx?: TransactionContext): Promise<DirectoryPerson | undefined>;
  isParentLinked(parentId: string, schoolId: string, tx?: TransactionContext): Promise<boolean>;
  findTeacherByUserId(userId: string, tx?: TransactionContext): Promise<DirectoryPerson | undefined>;
  isTeacherLinked(teacherId: string, schoolId: string, tx?: TransactionContext): Promise<boolean>;
  findStudentByNationalId(nationalId: string, tx?: TransactionContext): Promise<DirectoryStudent | undefined>;
  /** The group the student is in right now (an open assignment), if any. */
  currentGroupOfStudent(studentId: string, tx?: TransactionContext): Promise<{ id: string; name: string | null } | undefined>;
  findActiveGroupByName(schoolId: string, name: string, tx?: TransactionContext): Promise<DirectoryGroup | undefined>;
  listSlotsOfGroup(groupId: string, tx?: TransactionContext): Promise<DirectorySlot[]>;
  /** The Teacher's ACTIVE slots in every school (Master Specification §35). */
  listSlotsOfTeacher(teacherUserId: string, tx?: TransactionContext): Promise<DirectoryTeacherSlot[]>;
  /** Validates the raw `Governorate / Center / Village` text for the school's organization. Throws the Module 15 AppError when it is not accepted. */
  validateParentAddress(rawAddress: string, organizationId: string, tx?: TransactionContext): Promise<void>;
}
