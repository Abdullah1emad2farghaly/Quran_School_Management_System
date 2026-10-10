import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { SessionRepository } from '../../../../application/ports/session-repository';
import { AuthSession } from '../../../../domain/entities/auth-session';
import { RefreshTokenRecord } from '../../../../domain/entities/refresh-token-record';
import { sessionError } from '../../../../domain/errors/session-errors';
import type { SessionRevokeReason } from '../../../../domain/value-objects/session-revoke-reason';

type Queryable = Pick<Sequelize, 'query'>;
type DateLike = Date | string;
const asDate = (v: DateLike): Date => (v instanceof Date ? v : new Date(v));
const asNullableDate = (v: DateLike | null): Date | null => (v === null ? null : asDate(v));

interface SessionRow {
  id: string;
  userId: string;
  createdAt: DateLike;
  revokedAt: DateLike | null;
  revokedReason: SessionRevokeReason | null;
  version: number | string;
}
interface TokenRow {
  id: string;
  sessionId: string;
  userId: string;
  tokenHash: string;
  issuedAt: DateLike;
  expiresAt: DateLike;
  revokedAt: DateLike | null;
  replacedById: string | null;
  version: number | string;
}

const SELECT_SESSION = `
  SELECT id, user_id AS userId, created_at AS createdAt, revoked_at AS revokedAt,
         revoked_reason AS revokedReason, version
    FROM auth_sessions`;
const SELECT_TOKEN = `
  SELECT id, session_id AS sessionId, user_id AS userId, token_hash AS tokenHash, issued_at AS issuedAt,
         expires_at AS expiresAt, revoked_at AS revokedAt, replaced_by_id AS replacedById, version
    FROM refresh_tokens`;

export class SequelizeSessionRepository implements SessionRepository {
  constructor(private readonly db: Queryable) {}

  async insertSession(s: AuthSession, tx: TransactionContext): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO auth_sessions (id, user_id, revoked_at, revoked_reason, active, version, created_at, updated_at)
         VALUES (:id, :userId, NULL, NULL, 1, 1, :createdAt, :createdAt)`,
        { replacements: { id: s.id, userId: s.userId, createdAt: s.createdAt }, transaction: sequelizeTransactionOf(tx) ?? null },
      );
    } catch (error) {
      // The unique (user_id, active) index is the final guard: only one active session per user.
      if (error instanceof UniqueConstraintError) throw sessionError('SESSION_CONCURRENT_MODIFICATION');
      throw error;
    }
  }

  async updateSession(s: AuthSession, tx: TransactionContext): Promise<void> {
    const [, affected] = await this.db.query(
      `UPDATE auth_sessions
          SET revoked_at = :revokedAt, revoked_reason = :reason, active = IF(:revokedAt IS NULL, 1, NULL),
              updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      {
        replacements: {
          id: s.id,
          version: s.version,
          revokedAt: s.revokedAt,
          reason: s.revokedReason,
          updatedAt: s.revokedAt ?? s.createdAt,
        },
        type: QueryTypes.UPDATE,
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
    if (Number(affected) !== 1) throw sessionError('SESSION_CONCURRENT_MODIFICATION');
  }

  lockActiveSessionByUser(userId: string, tx: TransactionContext): Promise<AuthSession | undefined> {
    return this.oneSession(`${SELECT_SESSION} WHERE user_id = :v AND active = 1 FOR UPDATE`, userId, tx);
  }

  lockSession(sessionId: string, tx: TransactionContext): Promise<AuthSession | undefined> {
    return this.oneSession(`${SELECT_SESSION} WHERE id = :v FOR UPDATE`, sessionId, tx);
  }

  findSessionById(sessionId: string, tx?: TransactionContext): Promise<AuthSession | undefined> {
    return this.oneSession(`${SELECT_SESSION} WHERE id = :v`, sessionId, tx);
  }

  async insertRefreshToken(t: RefreshTokenRecord, tx: TransactionContext): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO refresh_tokens
           (id, session_id, user_id, token_hash, issued_at, expires_at, revoked_at, replaced_by_id, active, version, created_at, updated_at)
         VALUES
           (:id, :sessionId, :userId, :tokenHash, :issuedAt, :expiresAt, NULL, NULL, 1, 1, :issuedAt, :issuedAt)`,
        {
          replacements: {
            id: t.id,
            sessionId: t.sessionId,
            userId: t.userId,
            tokenHash: t.tokenHash,
            issuedAt: t.issuedAt,
            expiresAt: t.expiresAt,
          },
          transaction: sequelizeTransactionOf(tx) ?? null,
        },
      );
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw sessionError('SESSION_CONCURRENT_MODIFICATION');
      throw error;
    }
  }

  async updateRefreshToken(t: RefreshTokenRecord, tx: TransactionContext): Promise<void> {
    const [, affected] = await this.db.query(
      `UPDATE refresh_tokens
          SET revoked_at = :revokedAt, replaced_by_id = :replacedById, active = IF(:revokedAt IS NULL, 1, NULL),
              updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      {
        replacements: {
          id: t.id,
          version: t.version,
          revokedAt: t.revokedAt,
          replacedById: t.replacedById,
          updatedAt: t.revokedAt ?? t.issuedAt,
        },
        type: QueryTypes.UPDATE,
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
    if (Number(affected) !== 1) throw sessionError('SESSION_CONCURRENT_MODIFICATION');
  }

  findRefreshTokenByHash(tokenHash: string, tx: TransactionContext): Promise<RefreshTokenRecord | undefined> {
    return this.oneToken(`${SELECT_TOKEN} WHERE token_hash = :v`, tokenHash, tx);
  }

  lockRefreshToken(id: string, tx: TransactionContext): Promise<RefreshTokenRecord | undefined> {
    return this.oneToken(`${SELECT_TOKEN} WHERE id = :v FOR UPDATE`, id, tx);
  }

  lockActiveRefreshTokenBySession(sessionId: string, tx: TransactionContext): Promise<RefreshTokenRecord | undefined> {
    return this.oneToken(`${SELECT_TOKEN} WHERE session_id = :v AND active = 1 FOR UPDATE`, sessionId, tx);
  }

  private async oneSession(sql: string, value: string, tx?: TransactionContext): Promise<AuthSession | undefined> {
    const rows = await this.db.query<SessionRow>(sql, {
      replacements: { v: value },
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    const r = rows[0];
    if (!r) return undefined;
    return AuthSession.rehydrate({
      id: r.id,
      userId: r.userId,
      createdAt: asDate(r.createdAt),
      revokedAt: asNullableDate(r.revokedAt),
      revokedReason: r.revokedReason,
      version: Number(r.version),
    });
  }

  private async oneToken(sql: string, value: string, tx?: TransactionContext): Promise<RefreshTokenRecord | undefined> {
    const rows = await this.db.query<TokenRow>(sql, {
      replacements: { v: value },
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    const r = rows[0];
    if (!r) return undefined;
    return RefreshTokenRecord.rehydrate({
      id: r.id,
      sessionId: r.sessionId,
      userId: r.userId,
      tokenHash: r.tokenHash,
      issuedAt: asDate(r.issuedAt),
      expiresAt: asDate(r.expiresAt),
      revokedAt: asNullableDate(r.revokedAt),
      replacedById: r.replacedById,
      version: Number(r.version),
    });
  }
}
