import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { RevisionService } from '../../application/services/revision-service';
import { serializeAssignment, serializeBatch, serializeCorrection, serializeRecord, serializeSession } from './revision-serializer';

export type RevisionHandlerService = Pick<
  RevisionService,
  | 'defineAssignment' | 'modifyAssignment' | 'cancelAssignment' | 'recordRevision' | 'correctRecord' | 'getSessionRevision' | 'listStudentRecords'
  | 'findGroupIdOfSession' | 'findGroupIdOfAssignment' | 'findGroupIdOfRecord'
>;

export interface StudentRecordsRequest {
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

/** Framework-free handlers behind the revision routes. The caller always comes from the verified token, never from the body. Ranges are validated by Module 22. */
export function createRevisionHandlers(getService: () => RevisionHandlerService) {
  return {
    getSession: async (sessionId: string, userId: string) => serializeSession(await getService().getSessionRevision(sessionId, userId)),
    defineAssignment: async (sessionId: string, userId: string, body: unknown) => serializeAssignment(await getService().defineAssignment(sessionId, userId, { studentId: obj(body).studentId, range: obj(body).range })),
    modifyAssignment: async (assignmentId: string, userId: string, body: unknown) => serializeAssignment(await getService().modifyAssignment(assignmentId, userId, { range: obj(body).range })),
    cancelAssignment: async (assignmentId: string, userId: string) => serializeAssignment(await getService().cancelAssignment(assignmentId, userId)),
    recordRevision: async (sessionId: string, userId: string, body: unknown) => serializeBatch(await getService().recordRevision(sessionId, userId, { gps: obj(body).gps, records: obj(body).records })),
    correctRecord: async (recordId: string, userId: string, body: unknown) => serializeCorrection(await getService().correctRecord(recordId, userId, { gps: obj(body).gps, range: obj(body).range, reason: obj(body).reason })),
    listStudent: async (studentId: string, input: StudentRecordsRequest): Promise<PageResult<ReturnType<typeof serializeRecord>>> => {
      const page = await getService().listStudentRecords(studentId, input);
      return { ...page, items: page.items.map(serializeRecord) };
    },
    groupIdOfSession: (sessionId: string) => getService().findGroupIdOfSession(sessionId),
    groupIdOfAssignment: (assignmentId: string) => getService().findGroupIdOfAssignment(assignmentId),
    groupIdOfRecord: (recordId: string) => getService().findGroupIdOfRecord(recordId),
  };
}
