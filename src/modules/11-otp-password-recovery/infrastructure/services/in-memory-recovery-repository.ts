import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { RecoveryRepository } from '../../application/ports/recovery-ports';
import { PasswordRecovery, type PasswordRecoverySnapshot } from '../../domain/entities/password-recovery';
import { recoveryError } from '../../domain/errors/recovery-errors';
import type { RecoveryRequestRecord } from '../../domain/services/rate-limit-policy';

/** In-memory RecoveryRepository with the same uniqueness and optimistic-lock behavior. For tests. */
export class InMemoryRecoveryRepository implements RecoveryRepository {
  readonly recoveries = new Map<string, PasswordRecoverySnapshot>();
  readonly requests: Array<RecoveryRequestRecord & { phoneKey: string }> = [];
  readonly phoneLocks = new Set<string>();

  async lockPhone(phoneKey: string, _now: Date, _tx: TransactionContext): Promise<void> {
    this.phoneLocks.add(phoneKey);
  }

  async listRequestsSince(phoneKey: string, since: Date, _tx: TransactionContext): Promise<RecoveryRequestRecord[]> {
    return this.requests.filter((r) => r.phoneKey === phoneKey && r.requestedAt.getTime() > since.getTime());
  }

  async recordRequest(phoneKey: string, ipKey: string, now: Date, _tx: TransactionContext): Promise<void> {
    this.requests.push({ phoneKey, ipKey, requestedAt: now });
  }

  async lockLiveByUser(userId: string, _tx: TransactionContext): Promise<PasswordRecovery[]> {
    return [...this.recoveries.values()]
      .filter((r) => r.userId === userId && (r.status === 'PENDING' || r.status === 'VERIFIED'))
      .map((r) => PasswordRecovery.rehydrate(r));
  }

  async findByResetTokenHash(hash: string, _tx: TransactionContext): Promise<PasswordRecovery | undefined> {
    for (const r of this.recoveries.values()) if (r.resetTokenHash === hash) return PasswordRecovery.rehydrate(r);
    return undefined;
  }

  async lock(id: string, _tx: TransactionContext): Promise<PasswordRecovery | undefined> {
    const row = this.recoveries.get(id);
    return row ? PasswordRecovery.rehydrate(row) : undefined;
  }

  async insert(r: PasswordRecovery, _tx: TransactionContext): Promise<void> {
    for (const row of this.recoveries.values()) {
      if (row.userId === r.userId && (row.status === 'PENDING' || row.status === 'VERIFIED')) throw recoveryError('RECOVERY_CONCURRENT_MODIFICATION');
    }
    this.recoveries.set(r.id, this.snapshotOf(r, 1));
  }

  async update(r: PasswordRecovery, _tx: TransactionContext): Promise<void> {
    const row = this.recoveries.get(r.id);
    if (!row || row.version !== r.version) throw recoveryError('RECOVERY_CONCURRENT_MODIFICATION');
    this.recoveries.set(r.id, this.snapshotOf(r, r.version + 1));
  }

  async purgeOlderThan(before: Date): Promise<number> {
    let removed = 0;
    for (const [id, r] of this.recoveries) {
      if (r.createdAt.getTime() < before.getTime() && r.status !== 'PENDING' && r.status !== 'VERIFIED') {
        this.recoveries.delete(id);
        removed += 1;
      }
    }
    const kept = this.requests.filter((r) => r.requestedAt.getTime() >= before.getTime());
    removed += this.requests.length - kept.length;
    this.requests.splice(0, this.requests.length, ...kept);
    return removed;
  }

  private snapshotOf(r: PasswordRecovery, version: number): PasswordRecoverySnapshot {
    return {
      id: r.id,
      userId: r.userId,
      otpHash: r.otpHash,
      attempts: r.attempts,
      otpExpiresAt: r.otpExpiresAt,
      status: r.status,
      resetTokenHash: r.resetTokenHash,
      resetTokenExpiresAt: r.resetTokenExpiresAt,
      createdAt: r.createdAt,
      verifiedAt: r.verifiedAt,
      closedAt: r.closedAt,
      version,
    };
  }
}
