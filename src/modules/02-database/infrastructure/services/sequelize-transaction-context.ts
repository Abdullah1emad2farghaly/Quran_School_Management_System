import type { Transaction } from 'sequelize';
import type { TransactionContext } from '../../../00-shared-kernel/public';

/**
 * The Sequelize transaction is hidden behind an opaque handle. Application and
 * domain code only ever see `TransactionContext`; only infrastructure code
 * (repositories) can unwrap it via `sequelizeTransactionOf`.
 */
const registry = new WeakMap<object, Transaction>();

export function createTransactionContext(transaction: Transaction): TransactionContext {
  const context = Object.freeze({}) as unknown as TransactionContext;
  registry.set(context as object, transaction);
  return context;
}

/** For infrastructure layers only. `undefined` means "no transaction". */
export function sequelizeTransactionOf(context?: TransactionContext): Transaction | undefined {
  if (context === undefined) return undefined;
  const transaction = registry.get(context as object);
  if (!transaction) throw new Error('Unknown transaction context');
  return transaction;
}
