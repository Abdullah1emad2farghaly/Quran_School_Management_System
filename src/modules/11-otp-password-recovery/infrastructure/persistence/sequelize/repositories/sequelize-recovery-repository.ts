import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { RecoveryRepository } from '../../../../application/ports/recovery-ports';
import { PasswordRecovery } from '../../../../domain/entities/password-recovery';
import { recoveryError } from '../../../../domain/errors/recovery-errors';
import type { RecoveryRequestRecord } from '../../../../domain/services/rate-limit-policy';
import { LIVE_STATUSES, type RecoveryStatus } from '../../../../domain/value-objects/recovery-status';

type Queryable = Pick<Sequelize, 'query'>;
type DateLike = Date | string;
const asDate = (v: DateLike): Date => (v instanceof Date ? v : new Date(v));
const asNullableDate = (v: DateLike | null): Date | null => (v === null ? null : asDate(v));

interface Row {
  id: string;
  userId: string;
  otpHash: string;
  attempts: number | string;
  otpExpiresAt: DateLike;
  status: RecoveryStatus;
  resetTokenHash: string | null;
  resetTokenExpiresAt: DateLike | null;
  createdAt: DateLike;
  verifiedAt: DateLike | null;
  closedAt: DateLike | null;
  version: number | string;
}

const SELECT = `
  SELECT id, user_id AS userId, otp_hash AS otpHash, attempts, otp_expires_at AS otpExpiresAt, status,
         reset_token_hash AS resetTokenHash, reset_token_expires_at AS resetTokenExpiresAt,
         created_at AS createdAt, verified_at AS verifiedAt, closed_at AS closedAt, version
    FROM password_recoveries`;

export class SequelizeRecoveryRepository implements RecoveryRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * INSERT ... ON DUPLICATE KEY UPDATE takes an EXCLUSIVE lock on the phone's row (creating it when missing) and keeps it
   * until the transaction ends. Every other request for the same phone waits here, so the counts that follow cannot be
   * raced. (INSERT IGNORE + SELECT FOR UPDATE is avoided on purpose: it can deadlock when several requests start together.)
   */
  async lockPhone(phoneKey: string, now: Date, tx: TransactionContext): Promise<void> {
    await this.db.query(
      `INSERT INTO password_recovery_locks (phone_key, touched_at) VALUES (:phoneKey, :now)
       ON DUPLICATE KEY UPDATE touched_at = VALUES(touched_at)`,
      { replacements: { phoneKey, now }, transaction: sequelizeTransactionOf(tx) ?? null },
    );
  }

  async listRequestsSince(phoneKey: string, since: Date, tx: TransactionContext): Promise<RecoveryRequestRecord[]> {
    const rows = await this.db.query<{ ipKey: string; requestedAt: DateLike }>(
      `SELECT ip_key AS ipKey, requested_at AS requestedAt FROM password_recovery_requests
        WHERE phone_key = :phoneKey AND requested_at > :since ORDER BY requested_at, id`,
      { replacements: { phoneKey, since }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    return rows.map((r) => ({ ipKey: r.ipKey, requestedAt: asDate(r.requestedAt) }));
  }

  async recordRequest(phoneKey: string, ipKey: string, now: Date, tx: TransactionContext): Promise<void> {
    await this.db.query(
      'INSERT INTO password_recovery_requests (phone_key, ip_key, requested_at) VALUES (:phoneKey, :ipKey, :now)',
      { replacements: { phoneKey, ipKey, now }, transaction: sequelizeTransactionOf(tx) ?? null },
    );
  }

  lockLiveByUser(userId: string, tx: TransactionContext): Promise<PasswordRecovery[]> {
    return this.many(`${SELECT} WHERE user_id = :v AND live = 1 ORDER BY created_at, id FOR UPDATE`, userId, tx);
  }

  async findByResetTokenHash(resetTokenHash: string, tx: TransactionContext): Promise<PasswordRecovery | undefined> {
    return (await this.many(`${SELECT} WHERE reset_token_hash = :v`, resetTokenHash, tx))[0];
  }

  async lock(id: string, tx: TransactionContext): Promise<PasswordRecovery | undefined> {
    return (await this.many(`${SELECT} WHERE id = :v FOR UPDATE`, id, tx))[0];
  }

  async insert(r: PasswordRecovery, tx: TransactionContext): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO password_recoveries
           (id, user_id, otp_hash, attempts, otp_expires_at, status, live, reset_token_hash, reset_token_expires_at,
            verified_at, closed_at, version, created_at, updated_at)
         VALUES
           (:id, :userId, :otpHash, 0, :otpExpiresAt, 'PENDING', 1, NULL, NULL, NULL, NULL, 1, :createdAt, :createdAt)`,
        {
          replacements: { id: r.id, userId: r.userId, otpHash: r.otpHash, otpExpiresAt: r.otpExpiresAt, createdAt: r.createdAt },
          transaction: sequelizeTransactionOf(tx) ?? null,
        },
      );
    } catch (error) {
      // The unique (user_id, live) index is the final guard: only one live recovery per user.
      if (error instanceof UniqueConstraintError) throw recoveryError('RECOVERY_CONCURRENT_MODIFICATION');
      throw error;
    }
  }

  async update(r: PasswordRecovery, tx: TransactionContext): Promise<void> {
    const [, affected] = await this.db.query(
      `UPDATE password_recoveries
          SET attempts = :attempts, status = :status, live = :live, reset_token_hash = :resetTokenHash,
              reset_token_expires_at = :resetTokenExpiresAt, verified_at = :verifiedAt, closed_at = :closedAt,
              updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      {
        replacements: {
          id: r.id,
          version: r.version,
          attempts: r.attempts,
          status: r.status,
          live: LIVE_STATUSES.includes(r.status) ? 1 : null,
          resetTokenHash: r.resetTokenHash,
          resetTokenExpiresAt: r.resetTokenExpiresAt,
          verifiedAt: r.verifiedAt,
          closedAt: r.closedAt,
          updatedAt: r.closedAt ?? r.verifiedAt ?? r.createdAt,
        },
        type: QueryTypes.UPDATE,
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
    if (Number(affected) !== 1) throw recoveryError('RECOVERY_CONCURRENT_MODIFICATION');
  }

  async purgeOlderThan(before: Date): Promise<number> {
    let removed = 0;
    const run = async (sql: string): Promise<void> => {
      const affected = (await this.db.query(sql, { replacements: { before }, type: QueryTypes.BULKDELETE })) as unknown as number;
      removed += Number(affected ?? 0);
    };
    await run(`DELETE FROM password_recoveries WHERE live IS NULL AND created_at < :before`);
    await run(`DELETE FROM password_recovery_requests WHERE requested_at < :before`);
    await run(`DELETE FROM password_recovery_locks WHERE touched_at < :before`);
    return removed;
  }

  private async many(sql: string, value: string, tx: TransactionContext): Promise<PasswordRecovery[]> {
    const rows = await this.db.query<Row>(sql, {
      replacements: { v: value },
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    return rows.map((r) =>
      PasswordRecovery.rehydrate({
        id: r.id,
        userId: r.userId,
        otpHash: r.otpHash,
        attempts: Number(r.attempts),
        otpExpiresAt: asDate(r.otpExpiresAt),
        status: r.status,
        resetTokenHash: r.resetTokenHash,
        resetTokenExpiresAt: asNullableDate(r.resetTokenExpiresAt),
        createdAt: asDate(r.createdAt),
        verifiedAt: asNullableDate(r.verifiedAt),
        closedAt: asNullableDate(r.closedAt),
        version: Number(r.version),
      }),
    );
  }
}
