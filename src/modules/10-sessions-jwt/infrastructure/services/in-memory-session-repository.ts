import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { ActiveSessionView, SessionRepository } from '../../application/ports/session-repository';
import { AuthSession, type AuthSessionSnapshot } from '../../domain/entities/auth-session';
import { RefreshTokenRecord, type RefreshTokenSnapshot } from '../../domain/entities/refresh-token-record';
import { sessionError } from '../../domain/errors/session-errors';
import { isValidSessionSlot } from '../../domain/value-objects/session-policy';

/** In-memory SessionRepository with the same uniqueness (one active session per slot, slots 1..3) and optimistic-lock behavior. For tests. */
export class InMemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, AuthSessionSnapshot>();
  readonly tokens = new Map<string, RefreshTokenSnapshot>();

  async insertSession(s: AuthSession, _tx: TransactionContext): Promise<void> {
    if (!isValidSessionSlot(s.slot)) throw new RangeError('A session slot must be 1..3 (database CHECK).');
    for (const row of this.sessions.values()) {
      if (row.userId === s.userId && row.revokedAt === null && row.slot === s.slot) throw sessionError('SESSION_CONCURRENT_MODIFICATION');
    }
    this.sessions.set(s.id, this.sessionSnapshot(s, 1));
  }

  async updateSession(s: AuthSession, _tx: TransactionContext): Promise<void> {
    const row = this.sessions.get(s.id);
    if (!row || row.version !== s.version) throw sessionError('SESSION_CONCURRENT_MODIFICATION');
    this.sessions.set(s.id, this.sessionSnapshot(s, s.version + 1));
  }

  async lockActiveSessionsByUser(userId: string, _tx: TransactionContext): Promise<AuthSession[]> {
    return [...this.sessions.values()]
      .filter((row) => row.userId === userId && row.revokedAt === null)
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
      .map((row) => AuthSession.rehydrate(row));
  }

  async listActiveSessionViews(userId: string, now: Date, _tx?: TransactionContext): Promise<ActiveSessionView[]> {
    const views: ActiveSessionView[] = [];
    for (const row of this.sessions.values()) {
      if (row.userId !== userId || row.revokedAt !== null) continue;
      const token = this.currentToken(row.id);
      if (!token || token.expiresAt.getTime() <= now.getTime()) continue;
      views.push({ session: AuthSession.rehydrate(row), lastActiveAt: token.issuedAt, expiresAt: token.expiresAt });
    }
    return views.sort((a, b) => a.session.createdAt.getTime() - b.session.createdAt.getTime() || (a.session.slot ?? 0) - (b.session.slot ?? 0));
  }

  async findExpiredActiveSessionIds(now: Date, limit: number, _tx?: TransactionContext): Promise<string[]> {
    const ids: string[] = [];
    for (const row of this.sessions.values()) {
      if (row.revokedAt !== null) continue;
      const token = this.currentToken(row.id);
      if (!token || token.expiresAt.getTime() <= now.getTime()) ids.push(row.id);
      if (ids.length >= limit) break;
    }
    return ids;
  }

  private currentToken(sessionId: string): RefreshTokenSnapshot | undefined {
    for (const row of this.tokens.values()) if (row.sessionId === sessionId && row.revokedAt === null) return row;
    return undefined;
  }

  async lockSession(id: string, _tx: TransactionContext): Promise<AuthSession | undefined> {
    return this.findSessionById(id);
  }

  async findSessionById(id: string, _tx?: TransactionContext): Promise<AuthSession | undefined> {
    const row = this.sessions.get(id);
    return row ? AuthSession.rehydrate(row) : undefined;
  }

  async insertRefreshToken(t: RefreshTokenRecord, _tx: TransactionContext): Promise<void> {
    for (const row of this.tokens.values()) {
      if (row.tokenHash === t.tokenHash) throw sessionError('SESSION_CONCURRENT_MODIFICATION');
      if (row.sessionId === t.sessionId && row.revokedAt === null) throw sessionError('SESSION_CONCURRENT_MODIFICATION');
    }
    this.tokens.set(t.id, this.tokenSnapshot(t, 1));
  }

  async updateRefreshToken(t: RefreshTokenRecord, _tx: TransactionContext): Promise<void> {
    const row = this.tokens.get(t.id);
    if (!row || row.version !== t.version) throw sessionError('SESSION_CONCURRENT_MODIFICATION');
    this.tokens.set(t.id, this.tokenSnapshot(t, t.version + 1));
  }

  async findRefreshTokenByHash(tokenHash: string, _tx: TransactionContext): Promise<RefreshTokenRecord | undefined> {
    for (const row of this.tokens.values()) if (row.tokenHash === tokenHash) return RefreshTokenRecord.rehydrate(row);
    return undefined;
  }

  async lockRefreshToken(id: string, _tx: TransactionContext): Promise<RefreshTokenRecord | undefined> {
    const row = this.tokens.get(id);
    return row ? RefreshTokenRecord.rehydrate(row) : undefined;
  }

  async lockActiveRefreshTokenBySession(sessionId: string, _tx: TransactionContext): Promise<RefreshTokenRecord | undefined> {
    for (const row of this.tokens.values()) if (row.sessionId === sessionId && row.revokedAt === null) return RefreshTokenRecord.rehydrate(row);
    return undefined;
  }

  private sessionSnapshot(s: AuthSession, version: number): AuthSessionSnapshot {
    return { id: s.id, userId: s.userId, createdAt: s.createdAt, revokedAt: s.revokedAt, revokedReason: s.revokedReason, slot: s.slot, deviceLabel: s.deviceLabel, version };
  }

  private tokenSnapshot(t: RefreshTokenRecord, version: number): RefreshTokenSnapshot {
    return {
      id: t.id,
      sessionId: t.sessionId,
      userId: t.userId,
      tokenHash: t.tokenHash,
      issuedAt: t.issuedAt,
      expiresAt: t.expiresAt,
      revokedAt: t.revokedAt,
      replacedById: t.replacedById,
      version,
    };
  }
}
