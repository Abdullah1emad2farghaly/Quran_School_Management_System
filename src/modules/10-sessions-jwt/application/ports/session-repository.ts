import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { AuthSession } from '../../domain/entities/auth-session';
import type { RefreshTokenRecord } from '../../domain/entities/refresh-token-record';

/** An active, unexpired session with the data "My devices" shows. `lastActiveAt` is when its current refresh token was issued (login or last refresh). */
export interface ActiveSessionView {
  readonly session: AuthSession;
  readonly lastActiveAt: Date;
  /** When the session ends if it is not refreshed (the current refresh token's expiry). */
  readonly expiresAt: Date;
}

/**
 * Persistence for sessions and their refresh tokens. Lock order used by every use case: SESSION first,
 * then its refresh token, so concurrent logins/refreshes cannot deadlock.
 */
export interface SessionRepository {
  /**
   * Throws SESSION_CONCURRENT_MODIFICATION when the session's slot is already taken by another active session of the user (the unique
   * `(user_id, slot)` index is the final guard of the three-session limit) or on a deadlock.
   */
  insertSession(session: AuthSession, tx: TransactionContext): Promise<void>;
  /** Optimistic lock on `session.version`. Throws SESSION_CONCURRENT_MODIFICATION when stale. */
  updateSession(session: AuthSession, tx: TransactionContext): Promise<void>;
  /** ALL the user's active sessions (at most three), ordered by slot, locked for the rest of the transaction. */
  lockActiveSessionsByUser(userId: string, tx: TransactionContext): Promise<AuthSession[]>;
  /** The user's active sessions whose current refresh token has not expired at `now`, oldest first. A plain read (no lock). */
  listActiveSessionViews(userId: string, now: Date, tx?: TransactionContext): Promise<ActiveSessionView[]>;
  /** Ids of active sessions whose current refresh token expired at or before `now` (or that have none), at most `limit`. A plain read: callers re-check under the session lock. */
  findExpiredActiveSessionIds(now: Date, limit: number, tx?: TransactionContext): Promise<string[]>;
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
