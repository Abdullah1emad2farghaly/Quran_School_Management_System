declare const transactionBrand: unique symbol;

/**
 * Opaque handle for an active transaction. Only the database infrastructure
 * (Module 02) knows what is inside; Sequelize internals never leak out.
 */
export interface TransactionContext {
  readonly [transactionBrand]: true;
}

/** Runs work atomically: commit on success, roll back on any thrown error. */
export interface UnitOfWork {
  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
