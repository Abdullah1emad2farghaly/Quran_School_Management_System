import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { User } from '../../domain/entities/user';

export interface UserRepository {
  /**
   * Inserts a new user. Throws USER_PHONE_ALREADY_EXISTS when the phone is taken
   * (the database unique constraint is the final guard against races).
   */
  insert(user: User, tx: TransactionContext): Promise<void>;
  /** Optimistic lock on `user.version`. Throws USER_CONCURRENT_MODIFICATION when it is stale. */
  update(user: User, tx: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<User | undefined>;
  /** Expects an already-normalized E.164 phone. */
  findByPhone(phone: string, tx?: TransactionContext): Promise<User | undefined>;
}
