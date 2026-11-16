import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { ClassSessionService } from '../../application/services/class-session-service';
import type { SessionStatus } from '../../domain/value-objects/session-status';
import { serializeSession } from './session-serializer';

export type SessionHandlerService = Pick<ClassSessionService, 'listGroupSessions' | 'listOwnSessions' | 'getSession' | 'cancelSession' | 'findGroupIdOf'>;

export interface SessionListRequest {
  readonly status?: readonly SessionStatus[];
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

/**
 * Framework-free handlers behind the session routes: they map an already validated request to the application service and the response data. The caller
 * always comes from the verified token, never from the body; the cancellation reason is validated by the domain (CLASS_SESSION_CANCEL_REASON_* codes).
 */
export function createSessionHandlers(getService: () => SessionHandlerService) {
  const paged = async (result: Promise<PageResult<Parameters<typeof serializeSession>[0]>>): Promise<PageResult<ReturnType<typeof serializeSession>>> => {
    const page = await result;
    return { ...page, items: page.items.map(serializeSession) };
  };
  return {
    listGroupSessions: (groupId: string, input: SessionListRequest) => paged(getService().listGroupSessions(groupId, input)),
    listOwnSessions: (userId: string, input: SessionListRequest) => paged(getService().listOwnSessions(userId, input)),
    getSession: async (sessionId: string) => serializeSession(await getService().getSession(sessionId)),
    cancelSession: async (sessionId: string, userId: string, body: unknown) => serializeSession(await getService().cancelSession(sessionId, userId, obj(body).reason)),
    groupIdOf: (sessionId: string) => getService().findGroupIdOf(sessionId),
  };
}
