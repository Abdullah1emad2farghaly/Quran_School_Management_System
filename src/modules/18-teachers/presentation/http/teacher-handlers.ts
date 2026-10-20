import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { TeacherService } from '../../application/services/teacher-service';
import { serializeTeacher, serializeTeacherSchoolLink } from './teacher-serializer';

export type TeacherHandlerService = Pick<TeacherService, 'registerTeacher' | 'getTeacher' | 'getOwnProfile' | 'listTeachersOfSchool' | 'removeSchoolLink'>;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

/**
 * Framework-free handlers behind the teacher routes: they map an already validated request to the application service and the response data.
 * `actorId` / `userId` always come from the verified access token (`req.auth.userId`), never from the body.
 */
export function createTeacherHandlers(getService: () => TeacherHandlerService) {
  return {
    /** The actor was already authorized as the manager of `body.schoolId` by the Authorization Engine. */
    createTeacher: async (actorId: string, body: unknown) => {
      const b = obj(body);
      const result = await getService().registerTeacher({ schoolId: b.schoolId, name: b.name, phone: b.phone }, actorId);
      return { teacher: serializeTeacher(result.teacher), link: serializeTeacherSchoolLink(result.link), accountCreated: result.accountCreated };
    },

    getOwnProfile: async (userId: string) => serializeTeacher(await getService().getOwnProfile(userId)),

    getTeacher: async (teacherId: string) => serializeTeacher(await getService().getTeacher(teacherId)),

    listTeachersOfSchool: async (input: { schoolId: string; sort: { key: string; direction: 'asc' | 'desc' }; page: PageRequest }): Promise<PageResult<ReturnType<typeof serializeTeacher>>> => {
      const page = await getService().listTeachersOfSchool({ schoolId: input.schoolId, direction: input.sort.direction, page: input.page });
      return { ...page, items: page.items.map(serializeTeacher) };
    },

    removeSchoolLink: async (teacherId: string, schoolId: string, actorId: string) =>
      serializeTeacherSchoolLink(await getService().removeSchoolLink(teacherId, schoolId, actorId)),
  };
}
