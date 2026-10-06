import { QueryTypes, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { ClaimParams, NewOutboxRecord, OutboxRecord, OutboxStore } from '../../../../application/ports/outbox-store';

type Queryable = Pick<Sequelize, 'query'>;

interface OutboxRow {
  id: string | number;
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: string;
  metadata: string | null;
  occurredAt: Date | string;
  attempts: number | string;
}

/**
 * Outbox persistence on MariaDB/MySQL. All values are bound parameters.
 * Claiming uses a single UPDATE ... ORDER BY ... LIMIT (MariaDB 10.4 has no
 * SKIP LOCKED), so concurrent workers never receive the same message.
 */
export class SequelizeOutboxStore implements OutboxStore {
  constructor(private readonly db: Queryable) {}

  async append(records: readonly NewOutboxRecord[], tx: TransactionContext): Promise<void> {
    const transaction = sequelizeTransactionOf(tx);
    for (const r of records) {
      await this.db.query(
        `INSERT INTO outbox_messages
           (event_id, event_type, aggregate_type, aggregate_id, payload, metadata, occurred_at,
            status, attempts, next_attempt_at, created_at, updated_at)
         VALUES
           (:eventId, :eventType, :aggregateType, :aggregateId, :payload, :metadata, :occurredAt,
            'pending', 0, :nextAttemptAt, :now, :now)`,
        { replacements: { ...r, now: r.nextAttemptAt }, ...(transaction ? { transaction } : {}) },
      );
    }
  }

  async claim(p: ClaimParams): Promise<OutboxRecord[]> {
    await this.db.query(
      `UPDATE outbox_messages
          SET locked_by = :claimId, locked_until = :lockUntil, updated_at = :now
        WHERE status = 'pending'
          AND next_attempt_at <= :now
          AND (locked_until IS NULL OR locked_until < :now)
        ORDER BY id ASC
        LIMIT :limit`,
      { replacements: { claimId: p.claimId, lockUntil: p.lockUntil, now: p.now, limit: p.limit } },
    );
    const rows = await this.db.query<OutboxRow>(
      `SELECT id, event_id AS eventId, event_type AS eventType, aggregate_type AS aggregateType,
              aggregate_id AS aggregateId, payload, metadata, occurred_at AS occurredAt, attempts
         FROM outbox_messages
        WHERE locked_by = :claimId AND status = 'pending'
        ORDER BY id ASC`,
      { replacements: { claimId: p.claimId }, type: QueryTypes.SELECT },
    );
    return rows.map((r) => ({
      id: String(r.id),
      eventId: r.eventId,
      eventType: r.eventType,
      aggregateType: r.aggregateType,
      aggregateId: r.aggregateId,
      payload: r.payload,
      metadata: r.metadata,
      occurredAt: r.occurredAt instanceof Date ? r.occurredAt : new Date(r.occurredAt),
      attempts: Number(r.attempts),
    }));
  }

  async markProcessed(id: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE outbox_messages
          SET status = 'processed', processed_at = :at, last_error = NULL,
              locked_by = NULL, locked_until = NULL, updated_at = :at
        WHERE id = :id AND status = 'pending'`,
      { replacements: { id, at } },
    );
  }

  async markRetry(id: string, p: { attempts: number; nextAttemptAt: Date; error: string; at: Date }): Promise<void> {
    await this.db.query(
      `UPDATE outbox_messages
          SET attempts = :attempts, next_attempt_at = :nextAttemptAt, last_error = :error,
              locked_by = NULL, locked_until = NULL, updated_at = :at
        WHERE id = :id AND status = 'pending'`,
      { replacements: { id, ...p } },
    );
  }

  async markDead(id: string, p: { attempts: number; error: string; at: Date }): Promise<void> {
    await this.db.query(
      `UPDATE outbox_messages
          SET status = 'dead', attempts = :attempts, last_error = :error,
              locked_by = NULL, locked_until = NULL, updated_at = :at
        WHERE id = :id AND status = 'pending'`,
      { replacements: { id, ...p } },
    );
  }
}
