import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { EvaluationService } from '../../application/services/evaluation-service';
import { serializeBatch, serializeEvaluation, serializeSessionEvaluations } from './evaluation-serializer';

export type EvaluationHandlerService = Pick<EvaluationService, 'recordEvaluations' | 'getSessionEvaluations' | 'listStudentEvaluations' | 'findGroupIdOfSession'>;

export interface EvaluationListRequest {
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

/**
 * Framework-free handlers behind the evaluation routes: they map an already validated request to the application service and the response data. The caller always comes
 * from the verified token, never from the body. GPS, scores, categories and notes are validated by Smart Guard and the domain.
 */
export function createEvaluationHandlers(getService: () => EvaluationHandlerService) {
  return {
    recordEvaluations: async (sessionId: string, userId: string, body: unknown) => serializeBatch(await getService().recordEvaluations(sessionId, userId, { gps: obj(body).gps, records: obj(body).records })),
    getSession: async (sessionId: string, userId: string) => serializeSessionEvaluations(await getService().getSessionEvaluations(sessionId, userId)),
    listStudent: async (studentId: string, input: EvaluationListRequest): Promise<PageResult<ReturnType<typeof serializeEvaluation>>> => {
      const page = await getService().listStudentEvaluations(studentId, input);
      return { ...page, items: page.items.map(serializeEvaluation) };
    },
    groupIdOfSession: (sessionId: string) => getService().findGroupIdOfSession(sessionId),
  };
}
