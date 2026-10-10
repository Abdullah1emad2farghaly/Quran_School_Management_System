import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { AuthSession } from '../../domain/entities/auth-session';
import type { RefreshTokenRecord } from '../../domain/entities/refresh-token-record';

/**
 * Persistence for sessions and their refresh tokens. Lock order used by every use case: SESSION first,
 * then its refresh token, so concurrent logins/refreshes cannot deadlock.
 */
export interface SessionRepository {
  /** Throws SESSION_CONCURRENT_MODIFICATION when the user already has an active session (unique-index guard). */
  insertSession(session: AuthSession, tx: TransactionContext): Promise<void>;
  /** Optimistic lock on `session.version`. Throws SESSION_CONCURRENT_MODIFICATION when stale. */
  updateSession(session: AuthSession, tx: TransactionContext): Promise<void>;
  /** The user's active session (if any), locked for the rest of the transaction. */
  lockActiveSessionByUser(userId: string, tx: TransactionContext): Promise<AuthSession | undefined>;
  lockSession(sessionId: string, tx: TransactionContext): Promise<AuthSession | undefined>;
  findSessionById(sessionId: string, tx?: TransactionContext): Promise<AuthSession | undefined>;

  insertRefreshToken(token: RefreshTokenRecord, tx: TransactionContext): Promise<void>;
  /** Optimistic lock on `token.version`. Throws SESSION_CONCURRENT_MODIFICATION when stale. */
  updateRefreshToken(token: RefreshTokenRecord, tx: TransactionContext): Promise<void>;
  /** Plain read (no lock). Use only to discover the session id; re-read with `lockRefreshToken` before deciding. */
  findRefreshTokenByHash(tokenHash: string, tx: TransactionContext): Promise<RefreshTokenRecord | undefined>;
  lockRefreshToken(id: string, tx: TransactionContext): Promise<RefreshTokenRecord | undefined>;
  /** The session's current (not revoked) refresh token, locked. */
  lockActiveRefreshTokenBySession(sessionId: string, tx: TransactionContext): Promise<RefreshTokenRecord | undefined>;
}
