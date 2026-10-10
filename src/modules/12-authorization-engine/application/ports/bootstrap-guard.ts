import type { TransactionContext } from '../../../00-shared-kernel/public';

/**
 * Serializes first-Main-Admin bootstraps. Without it two concurrent runs could both see "no Main Admin yet" and
 * each create one. Implemented with a row lock inside the bootstrap transaction (see the Sequelize adapter).
 */
export interface BootstrapGuard {
  /** Blocks until no other bootstrap transaction is in progress; the lock lasts until the transaction ends. */
  lockExclusive(tx: TransactionContext): Promise<void>;
  /** Records which user the last successful bootstrap created (operational trace; no secrets). */
  recordBootstrap(input: { readonly userId: string; readonly at: Date }, tx: TransactionContext): Promise<void>;
}
