import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { StudentSortKey } from '../../application/ports/student-repository';
import type { StudentService } from '../../application/services/student-service';
import { isStudentStatus, type StudentStatus } from '../../domain/value-objects/student-status';
import { serializeStudent, serializeStudentForTeacher, serializeStudentHistory } from './student-serializer';

export type StudentHandlerService = Pick<
  StudentService,
  'registerStudent' | 'getStudent' | 'listStudentsOfSchool' | 'listChildrenOfParentUser' | 'listHistory' | 'updateStudent' | 'deactivateStudent' | 'reactivateStudent' | 'archiveStudent'
>;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

export interface StudentListRequest {
  readonly sort: { key: string; direction: 'asc' | 'desc' };
  readonly status: readonly string[] | undefined;
  readonly page: PageRequest;
}

const statuses = (value: readonly string[] | undefined): StudentStatus[] | undefined => value?.filter(isStudentStatus);

/**
 * Framework-free handlers behind the student routes: they map an already validated request to the application service and the response
 * data. `actorId` / `userId` and the authorized `role` always come from the verified token and the Authorization Engine, never from the body.
 */
export function createStudentHandlers(getService: () => StudentHandlerService) {
  return {
    /** The actor was already authorized as the manager of `body.schoolId` by the Authorization Engine. */
    createStudent: async (actorId: string, body: unknown) => {
      const b = obj(body);
      return serializeStudent(await getService().registerStudent({ schoolId: b.schoolId as string, parentId: b.parentId as string, fullName: b.fullName, nationalId: b.nationalId, joinDate: b.joinDate }, actorId));
    },

    /** A TEACHER (authorized through a group assigned to them) gets the minimal view; the School Manager and the Parent get the full one. */
    getStudent: async (studentId: string, role: string | undefined) => {
      const student = await getService().getStudent(studentId);
      return role === 'TEACHER' ? serializeStudentForTeacher(student) : serializeStudent(student);
    },

    listStudentsOfSchool: async (schoolId: string, input: StudentListRequest): Promise<PageResult<ReturnType<typeof serializeStudent>>> => {
      const page = await getService().listStudentsOfSchool(schoolId, { sort: input.sort.key as StudentSortKey, direction: input.sort.direction, ...(input.status ? { status: statuses(input.status)! } : {}), page: input.page });
      return { ...page, items: page.items.map(serializeStudent) };
    },

    listOwnChildren: async (userId: string, input: StudentListRequest): Promise<PageResult<ReturnType<typeof serializeStudent>>> => {
      const page = await getService().listChildrenOfParentUser(userId, { sort: input.sort.key as StudentSortKey, direction: input.sort.direction, ...(input.status ? { status: statuses(input.status)! } : {}), page: input.page });
      return { ...page, items: page.items.map(serializeStudent) };
    },

    listHistory: async (studentId: string) => (await getService().listHistory(studentId)).map(serializeStudentHistory),

    updateStudent: async (studentId: string, actorId: string, body: unknown) => {
      const b = obj(body);
      return serializeStudent(await getService().updateStudent(studentId, { ...(b.fullName !== undefined ? { fullName: b.fullName } : {}), ...(b.joinDate !== undefined ? { joinDate: b.joinDate } : {}) }, actorId));
    },

    deactivateStudent: async (studentId: string, actorId: string, body: unknown) => serializeStudent(await getService().deactivateStudent(studentId, obj(body).reason, actorId)),
    reactivateStudent: async (studentId: string, actorId: string, body: unknown) => serializeStudent(await getService().reactivateStudent(studentId, obj(body).reason, actorId)),
    archiveStudent: async (studentId: string, actorId: string, body: unknown) => serializeStudent(await getService().archiveStudent(studentId, obj(body).reason, actorId)),
  };
}
