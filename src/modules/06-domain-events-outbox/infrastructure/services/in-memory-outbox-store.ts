import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { ClaimParams, NewOutboxRecord, OutboxRecord, OutboxStore } from '../../application/ports/outbox-store';

export interface StoredOutboxMessage extends OutboxRecord {
  status: 'pending' | 'processed' | 'dead';
  nextAttemptAt: Date;
  lockedBy: string | null;
  lockedUntil: Date | null;
  lastError: string | null;
}

/** In-memory OutboxStore with the same claim semantics. For tests of modules that publish/handle events. */
export class InMemoryOutboxStore implements OutboxStore {
  readonly messages: StoredOutboxMessage[] = [];
  private nextId = 1;

  async append(records: readonly NewOutboxRecord[], _tx: TransactionContext): Promise<void> {
    for (const r of records) {
      this.messages.push({
        id: String(this.nextId++),
        eventId: r.eventId,
        eventType: r.eventType,
        aggregateType: r.aggregateType,
        aggregateId: r.aggregateId,
        payload: r.payload,
        metadata: r.metadata,
        occurredAt: r.occurredAt,
        attempts: 0,
        status: 'pending',
        nextAttemptAt: r.nextAttemptAt,
        lockedBy: null,
        lockedUntil: null,
        lastError: null,
      });
    }
  }

  async claim(p: ClaimParams): Promise<OutboxRecord[]> {
    const due = this.messages
      .filter(
        (m) =>
          m.status === 'pending' &&
          m.nextAttemptAt <= p.now &&
          (m.lockedUntil === null || m.lockedUntil < p.now),
      )
      .slice(0, p.limit);
    for (const m of due) {
      m.lockedBy = p.claimId;
      m.lockedUntil = p.lockUntil;
    }
    return due.map((m) => ({ ...m }));
  }

  private find(id: string): StoredOutboxMessage | undefined {
    return this.messages.find((m) => m.id === id && m.status === 'pending');
  }

  async markProcessed(id: string, _at: Date): Promise<void> {
    const m = this.find(id);
    if (m) Object.assign(m, { status: 'processed', lockedBy: null, lockedUntil: null, lastError: null });
  }

  async markRetry(id: string, p: { attempts: number; nextAttemptAt: Date; error: string }): Promise<void> {
    const m = this.find(id);
    if (m) Object.assign(m, { attempts: p.attempts, nextAttemptAt: p.nextAttemptAt, lastError: p.error, lockedBy: null, lockedUntil: null });
  }

  async markDead(id: string, p: { attempts: number; error: string }): Promise<void> {
    const m = this.find(id);
    if (m) Object.assign(m, { status: 'dead', attempts: p.attempts, lastError: p.error, lockedBy: null, lockedUntil: null });
  }
}
