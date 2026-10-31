import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { AttendanceService } from '../../application/services/attendance-service';
import { serializeBatch, serializeRecord, serializeSessionAttendance } from './attendance-serializer';

export type AttendanceHandlerService = Pick<
  AttendanceService,
  'recordStudentAttendance' | 'checkInTeacher' | 'setTeacherAttendanceByManager' | 'setStudentAttendanceByManager' | 'getSessionAttendance' | 'listStudentAttendance' | 'findGroupIdOfSession'
>;

export interface AttendanceListRequest {
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

/**
 * Framework-free handlers behind the attendance routes: they map an already validated request to the application service and the response data. The caller always
 * comes from the verified token, never from the body. GPS, statuses and reasons are validated by Smart Guard and the domain.
 */
export function createAttendanceHandlers(getService: () => AttendanceHandlerService) {
  return {
    recordStudents: async (sessionId: string, userId: string, body: unknown) => serializeBatch(await getService().recordStudentAttendance(sessionId, userId, { gps: obj(body).gps, records: obj(body).records })),
    checkInTeacher: async (sessionId: string, userId: string, body: unknown) => serializeBatch(await getService().checkInTeacher(sessionId, userId, { gps: obj(body).gps, reason: obj(body).reason })),
    setTeacherByManager: async (sessionId: string, userId: string, body: unknown) => serializeBatch(await getService().setTeacherAttendanceByManager(sessionId, userId, { status: obj(body).status, reason: obj(body).reason })),
    setStudentByManager: async (sessionId: string, studentId: string, userId: string, body: unknown) =>
      serializeBatch(await getService().setStudentAttendanceByManager(sessionId, studentId, userId, { status: obj(body).status, reason: obj(body).reason })),
    getSession: async (sessionId: string, userId: string) => serializeSessionAttendance(await getService().getSessionAttendance(sessionId, userId)),
    listStudent: async (studentId: string, input: AttendanceListRequest): Promise<PageResult<ReturnType<typeof serializeRecord>>> => {
      const page = await getService().listStudentAttendance(studentId, input);
      return { ...page, items: page.items.map(serializeRecord) };
    },
    groupIdOfSession: (sessionId: string) => getService().findGroupIdOfSession(sessionId),
  };
}
