import { AsyncLocalStorage } from 'node:async_hooks';
import type { Transaction } from 'sequelize';
import type { TransactionContext, UnitOfWork } from '../../../00-shared-kernel/public';
import { createTransactionContext } from './sequelize-transaction-context';

/** The part of Sequelize this class needs (managed transactions). */
export interface TransactionRunner {
  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
}

const activeContext = new AsyncLocalStorage<TransactionContext>();

/**
 * Sequelize-backed UnitOfWork.
 * - Commits when `work` resolves; rolls back and rethrows when it throws.
 * - Nested `run` calls JOIN the active transaction (same context, no new
 *   transaction), so use cases can call each other safely. Only the outermost
 *   `run` commits or rolls back.
 * - Do not leave promises running after `work` returns; they would use a
 *   finished transaction.
 */
export class SequelizeUnitOfWork implements UnitOfWork {
  constructor(private readonly runner: TransactionRunner) {}

  async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const existing = activeContext.getStore();
    if (existing) return work(existing);

    return this.runner.transaction(async (transaction) => {
      const context = createTransactionContext(transaction);
      return activeContext.run(context, () => work(context));
    });
  }
}
