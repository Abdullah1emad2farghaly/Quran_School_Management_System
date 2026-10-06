import type { TransactionContext } from '../../../00-shared-kernel/public';

export interface NewOutboxRecord {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** JSON text. */
  readonly payload: string;
  /** JSON text or null. */
  readonly metadata: string | null;
  readonly occurredAt: Date;
  /** When the message first becomes eligible for delivery. */
  readonly nextAttemptAt: Date;
}

export interface OutboxRecord {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: string;
  readonly metadata: string | null;
  readonly occurredAt: Date;
  /** Failed attempts so far. */
  readonly attempts: number;
}

export interface ClaimParams {
  /** Unique per claim; written to the rows so only this claim can see them. */
  readonly claimId: string;
  readonly now: Date;
  readonly lockUntil: Date;
  readonly limit: number;
}

/** Persistence port for the outbox. `append` REQUIRES a transaction (atomic with the business change). */
export interface OutboxStore {
  append(records: readonly NewOutboxRecord[], tx: TransactionContext): Promise<void>;
  /** Atomically locks up to `limit` due, unlocked (or lock-expired) pending messages, oldest first. */
  claim(params: ClaimParams): Promise<OutboxRecord[]>;
  markProcessed(id: string, at: Date): Promise<void>;
  markRetry(id: string, params: { attempts: number; nextAttemptAt: Date; error: string; at: Date }): Promise<void>;
  markDead(id: string, params: { attempts: number; error: string; at: Date }): Promise<void>;
}
