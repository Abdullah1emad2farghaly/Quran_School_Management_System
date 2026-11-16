import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { QuranStructureLookup } from '../../../21-quran-structure/public';
import type { MemorizationService } from '../../application/services/memorization-service';
import { serializeAssignment, serializeBatch, serializeCorrection, serializeRecord, serializeSession } from './memorization-serializer';

export type MemorizationHandlerService = Pick<
  MemorizationService,
  | 'defineAssignment' | 'modifyAssignment' | 'cancelAssignment' | 'recordMemorization' | 'correctRecord' | 'getSessionMemorization' | 'listStudentRecords'
  | 'findGroupIdOfSession' | 'findGroupIdOfAssignment' | 'findGroupIdOfRecord'
>;

export interface StudentRecordsRequest {
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

/** Framework-free handlers behind the memorization routes. The caller always comes from the verified token, never from the body. Ranges are validated by Module 22. */
export function createMemorizationHandlers(getService: () => MemorizationHandlerService, getQuran: () => Pick<QuranStructureLookup, 'listAyahs'>) {
  return {
    /** The approved Quran ayahs for the memorization selection UI: Module 21's own contract and DTO, unchanged and not filtered by any student progress. */
    listAyahs: (input: StudentRecordsRequest) => getQuran().listAyahs(input.page, input.direction),
    getSession: async (sessionId: string, userId: string) => serializeSession(await getService().getSessionMemorization(sessionId, userId)),
    defineAssignment: async (sessionId: string, userId: string, body: unknown) => serializeAssignment(await getService().defineAssignment(sessionId, userId, { studentId: obj(body).studentId, range: obj(body).range })),
    modifyAssignment: async (assignmentId: string, userId: string, body: unknown) => serializeAssignment(await getService().modifyAssignment(assignmentId, userId, { range: obj(body).range })),
    cancelAssignment: async (assignmentId: string, userId: string) => serializeAssignment(await getService().cancelAssignment(assignmentId, userId)),
    recordMemorization: async (sessionId: string, userId: string, body: unknown) => serializeBatch(await getService().recordMemorization(sessionId, userId, { gps: obj(body).gps, records: obj(body).records })),
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
