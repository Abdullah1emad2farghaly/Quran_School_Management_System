import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { UserRepository } from '../../application/ports/user-repository';
import { User, type UserSnapshot } from '../../domain/entities/user';
import { identityError } from '../../domain/errors/identity-errors';

/** In-memory UserRepository with the same uniqueness and optimistic-lock behavior. For tests of other modules. */
export class InMemoryUserRepository implements UserRepository {
  readonly rows = new Map<string, UserSnapshot>();

  async insert(user: User, _tx: TransactionContext): Promise<void> {
    for (const row of this.rows.values()) if (row.phone === user.phone) throw identityError('USER_PHONE_ALREADY_EXISTS');
    this.rows.set(user.id, this.snapshotOf(user, 1));
  }

  async update(user: User, _tx: TransactionContext): Promise<void> {
    const row = this.rows.get(user.id);
    if (!row || row.version !== user.version) throw identityError('USER_CONCURRENT_MODIFICATION');
    this.rows.set(user.id, this.snapshotOf(user, user.version + 1));
  }

  async findById(id: string, _tx?: TransactionContext): Promise<User | undefined> {
    const row = this.rows.get(id);
    return row ? User.rehydrate(row) : undefined;
  }

  async findByPhone(phone: string, _tx?: TransactionContext): Promise<User | undefined> {
    for (const row of this.rows.values()) if (row.phone === phone) return User.rehydrate(row);
    return undefined;
  }

  private snapshotOf(user: User, version: number): UserSnapshot {
    return {
      id: user.id,
      phone: user.phone,
      passwordHash: user.passwordHash,
      status: user.status,
      statusChangedAt: user.statusChangedAt,
      version,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
